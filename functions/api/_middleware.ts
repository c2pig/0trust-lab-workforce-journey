import {
  buildOtlpLogPayload,
  buildOtlpTracePayload,
  parseOrCreateTraceparent,
  postOtlpPayload,
  redactAuthHeader,
  redactJwtSignatures,
  sanitizeSessionId,
  type OtlpEnv
} from './_telemetry.ts';

export type EdgeMiddlewareEnv = OtlpEnv;

export { redactJwtSignatures };

const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const SCOPE_NAME = 'functions/api/_middleware.ts';
const SCOPE_VERSION = '1.0.0';

export function resolveServiceName(env: EdgeMiddlewareEnv): string {
  return env.OTEL_SERVICE_NAME || (env.LAB_SLUG ? `zerotrust-lab-${env.LAB_SLUG}` : '0trust-dev-edge');
}

export interface TelemetrySpanMetadata {
  traceparent: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  session_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  timestamp: string;
  otlp_export: 'configured' | 'in-lab-only';
  redacted_auth_header: string | null;
  redaction_applied: boolean;
}

function scheduleOtlpExport(
  context: {
    env: EdgeMiddlewareEnv;
    waitUntil?: (promise: Promise<unknown>) => void;
  },
  telemetry: TelemetrySpanMetadata,
  startUnixNano: string,
  endUnixNano: string,
  errorMessage?: string
): void {
  if (!context.env.OTLP_ENDPOINT?.trim() || typeof context.waitUntil !== 'function') {
    return;
  }

  const serviceName = resolveServiceName(context.env);
  const tracePayload = buildOtlpTracePayload({
    serviceName,
    environment: context.env.ENVIRONMENT,
    scopeName: SCOPE_NAME,
    scopeVersion: SCOPE_VERSION,
    traceId: telemetry.trace_id,
    spanId: telemetry.span_id,
    parentSpanId: telemetry.parent_span_id,
    method: telemetry.method,
    path: telemetry.path,
    status: telemetry.status,
    latencyMs: telemetry.latency_ms,
    sessionId: telemetry.session_id,
    redactionApplied: telemetry.redaction_applied,
    startUnixNano,
    endUnixNano,
    errorMessage
  });

  const logPayload = buildOtlpLogPayload({
    serviceName,
    environment: context.env.ENVIRONMENT,
    scopeName: SCOPE_NAME,
    scopeVersion: SCOPE_VERSION,
    traceId: telemetry.trace_id,
    spanId: telemetry.span_id,
    method: telemetry.method,
    path: telemetry.path,
    status: telemetry.status,
    latencyMs: telemetry.latency_ms,
    sessionId: telemetry.session_id,
    redactionApplied: telemetry.redaction_applied,
    endUnixNano,
    errorMessage
  });

  context.waitUntil(
    Promise.allSettled([
      postOtlpPayload(context.env, '/v1/traces', tracePayload),
      postOtlpPayload(context.env, '/v1/logs', logPayload)
    ])
  );
}

export async function onRequest(context: {
  request: Request;
  env: EdgeMiddlewareEnv;
  next: () => Promise<Response>;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const startMs = Date.now();
  const startPerf = performance.now();
  const url = new URL(context.request.url);

  const traceInfo = parseOrCreateTraceparent(context.request.headers.get('traceparent'));
  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || url.searchParams.get('session')
  );

  const authRedaction = redactAuthHeader(context.request.headers.get('Authorization'));
  const otlpConfigured =
    Boolean(context.env.OTLP_ENDPOINT?.trim()) && typeof context.waitUntil === 'function';

  let response: Response;
  try {
    response = await context.next();
  } catch (err) {
    const latencyMs = Math.max(1, Math.round(performance.now() - startPerf));
    const endMs = Date.now();
    const errorMessage = err instanceof Error ? err.message : String(err);

    const errorTelemetry: TelemetrySpanMetadata = {
      traceparent: traceInfo.traceparent,
      trace_id: traceInfo.traceId,
      span_id: traceInfo.spanId,
      parent_span_id: traceInfo.parentSpanId ?? '0000000000000000',
      session_id: sessionId,
      method: context.request.method,
      path: url.pathname,
      status: 500,
      latency_ms: latencyMs,
      timestamp: new Date().toISOString(),
      otlp_export: otlpConfigured ? 'configured' : 'in-lab-only',
      redacted_auth_header: authRedaction.redacted,
      redaction_applied: authRedaction.changed
    };

    scheduleOtlpExport(
      context,
      errorTelemetry,
      `${startMs}000000`,
      `${endMs}000000`,
      errorMessage
    );

    return new Response(
      JSON.stringify({
        error: 'INTERNAL_EDGE_ERROR',
        trace_id: traceInfo.traceId
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          traceparent: traceInfo.traceparent,
          'X-Edge-Latency-Ms': String(latencyMs)
        }
      }
    );
  }

  const latencyMs = Math.max(1, Math.round(performance.now() - startPerf));
  const endMs = Date.now();

  const telemetry: TelemetrySpanMetadata = {
    traceparent: traceInfo.traceparent,
    trace_id: traceInfo.traceId,
    span_id: traceInfo.spanId,
    parent_span_id: traceInfo.parentSpanId ?? '0000000000000000',
    session_id: sessionId,
    method: context.request.method,
    path: url.pathname,
    status: response.status,
    latency_ms: latencyMs,
    timestamp: new Date().toISOString(),
    otlp_export: otlpConfigured ? 'configured' : 'in-lab-only',
    redacted_auth_header: authRedaction.redacted,
    redaction_applied: authRedaction.changed
  };

  scheduleOtlpExport(context, telemetry, `${startMs}000000`, `${endMs}000000`);

  const headers = new Headers(response.headers);
  headers.set('traceparent', traceInfo.traceparent);
  headers.set('X-Edge-Latency-Ms', String(latencyMs));

  if (NULL_BODY_STATUSES.has(response.status)) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    try {
      const cloned = response.clone();
      const bodyJson = (await cloned.json()) as Record<string, unknown>;
      if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
        headers.delete('content-length');
        headers.delete('content-encoding');
        bodyJson._telemetry = telemetry;
        return new Response(JSON.stringify(bodyJson), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }
    } catch {
      // Fall through and return original response with trace headers
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
