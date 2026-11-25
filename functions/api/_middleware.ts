import {
  buildResourceAttributes,
  parseOrCreateTraceparent,
  postOtlpPayload,
  redactJwtSignatures,
  sanitizeSessionId,
  type OtlpEnv
} from './_telemetry.ts';

export type EdgeMiddlewareEnv = OtlpEnv;

export { redactJwtSignatures };

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

function mapStatusToSeverity(status: number): {
  severityNumber: number;
  severityText: 'ERROR' | 'WARN' | 'INFO';
} {
  if (status >= 500) {
    return { severityNumber: 17, severityText: 'ERROR' };
  }
  if (status >= 400) {
    return { severityNumber: 13, severityText: 'WARN' };
  }
  return { severityNumber: 9, severityText: 'INFO' };
}

async function exportOtlpTrace(
  env: EdgeMiddlewareEnv,
  telemetry: TelemetrySpanMetadata,
  startUnixNano: string,
  endUnixNano: string
): Promise<void> {
  if (!env.OTLP_ENDPOINT) return;

  const otlpPayload = {
    resourceSpans: [
      {
        resource: {
          attributes: buildResourceAttributes(resolveServiceName(env), env.ENVIRONMENT)
        },
        scopeSpans: [
          {
            scope: { name: 'functions/api/_middleware.ts', version: '1.0.0' },
            spans: [
              {
                traceId: telemetry.trace_id,
                spanId: telemetry.span_id,
                parentSpanId:
                  telemetry.parent_span_id === '0000000000000000'
                    ? undefined
                    : telemetry.parent_span_id,
                name: `${telemetry.method} ${telemetry.path}`,
                kind: 2,
                startTimeUnixNano: startUnixNano,
                endTimeUnixNano: endUnixNano,
                attributes: [
                  { key: 'http.method', value: { stringValue: telemetry.method } },
                  { key: 'http.target', value: { stringValue: telemetry.path } },
                  { key: 'http.status_code', value: { intValue: telemetry.status } },
                  { key: '0trust.session_id', value: { stringValue: telemetry.session_id } },
                  { key: '0trust.latency_ms', value: { intValue: telemetry.latency_ms } },
                  { key: '0trust.redaction_applied', value: { boolValue: telemetry.redaction_applied } }
                ],
                status: { code: telemetry.status >= 500 ? 2 : 1 }
              }
            ]
          }
        ]
      }
    ]
  };

  await postOtlpPayload(env, '/v1/traces', otlpPayload);
}

async function exportOtlpLog(
  env: EdgeMiddlewareEnv,
  telemetry: TelemetrySpanMetadata,
  endUnixNano: string
): Promise<void> {
  if (!env.OTLP_ENDPOINT) return;
  const { severityNumber, severityText } = mapStatusToSeverity(telemetry.status);

  const rawBody = JSON.stringify({
    message: `${telemetry.method} ${telemetry.path} -> ${telemetry.status} (${telemetry.latency_ms}ms)`,
    session_id: telemetry.session_id,
    method: telemetry.method,
    path: telemetry.path,
    status: telemetry.status,
    latency_ms: telemetry.latency_ms,
    redaction_applied: telemetry.redaction_applied,
    trace_id: telemetry.trace_id,
    span_id: telemetry.span_id
  });
  const bodyRedaction = redactJwtSignatures(rawBody);
  const redactionApplied = telemetry.redaction_applied || bodyRedaction.changed;

  const otlpLogPayload = {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(resolveServiceName(env), env.ENVIRONMENT)
        },
        scopeLogs: [
          {
            scope: { name: 'functions/api/_middleware.ts', version: '1.0.0' },
            logRecords: [
              {
                timeUnixNano: endUnixNano,
                observedTimeUnixNano: endUnixNano,
                severityNumber,
                severityText,
                traceId: telemetry.trace_id,
                spanId: telemetry.span_id,
                body: { stringValue: bodyRedaction.redacted },
                attributes: [
                  { key: '0trust.session_id', value: { stringValue: telemetry.session_id } },
                  { key: 'http.method', value: { stringValue: telemetry.method } },
                  { key: 'http.target', value: { stringValue: telemetry.path } },
                  { key: 'http.status_code', value: { intValue: telemetry.status } },
                  { key: '0trust.latency_ms', value: { intValue: telemetry.latency_ms } },
                  { key: '0trust.redaction_applied', value: { boolValue: redactionApplied } },
                  { key: 'trace_id', value: { stringValue: telemetry.trace_id } },
                  { key: 'span_id', value: { stringValue: telemetry.span_id } }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  await postOtlpPayload(env, '/v1/logs', otlpLogPayload);
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

  const rawAuth = context.request.headers.get('Authorization');
  const authRedaction = rawAuth ? redactJwtSignatures(rawAuth) : { redacted: '', changed: false };

  const response = await context.next();
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
    otlp_export: context.env.OTLP_ENDPOINT ? 'configured' : 'in-lab-only',
    redacted_auth_header: rawAuth ? authRedaction.redacted : null,
    redaction_applied: authRedaction.changed
  };

  if (context.env.OTLP_ENDPOINT && typeof context.waitUntil === 'function') {
    const startNano = `${startMs}000000`;
    const endNano = `${endMs}000000`;
    context.waitUntil(
      Promise.allSettled([
        exportOtlpTrace(context.env, telemetry, startNano, endNano),
        exportOtlpLog(context.env, telemetry, endNano)
      ])
    );
  }

  const contentType = response.headers.get('Content-Type') || '';
  const headers = new Headers(response.headers);
  headers.set('traceparent', traceInfo.traceparent);
  headers.set('X-Edge-Latency-Ms', String(latencyMs));

  if (contentType.includes('application/json')) {
    try {
      const cloned = response.clone();
      const bodyJson = (await cloned.json()) as Record<string, unknown>;
      if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
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
