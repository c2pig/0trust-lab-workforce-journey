export interface OtlpEnv {
  ENVIRONMENT?: string;
  OTLP_ENDPOINT?: string;
  OTLP_AUTH_HEADER?: string;
  OTEL_SERVICE_NAME?: string;
  LAB_SLUG?: string;
}

export interface ParsedTraceparent {
  traceparent: string;
  traceId: string;
  parentSpanId?: string;
  spanId: string;
}

export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseOrCreateTraceparent(incoming: string | null): ParsedTraceparent {
  const spanId = randomHex(8);
  if (incoming) {
    const match = incoming.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
    if (match) {
      const traceId = match[1].toLowerCase();
      const parentSpanId = match[2].toLowerCase();
      if (!/^0+$/.test(traceId) && !/^0+$/.test(parentSpanId)) {
        return {
          traceparent: `00-${traceId}-${spanId}-01`,
          traceId,
          parentSpanId,
          spanId
        };
      }
    }
  }
  const traceId = randomHex(16);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId
  };
}

export function sanitizeSessionId(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'demo-visitor';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo-visitor';
}

export interface RedactAuthResult {
  redacted: string | null;
  changed: boolean;
}

export interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { intValue: number } | { boolValue: boolean };
}

export interface OtlpTraceInput {
  serviceName: string;
  environment?: string;
  scopeName: string;
  scopeVersion?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  sessionId: string;
  redactionApplied: boolean;
  startUnixNano: string;
  endUnixNano: string;
  extraAttributes?: OtlpAttribute[];
  errorMessage?: string;
}

export interface OtlpLogInput {
  serviceName: string;
  environment?: string;
  scopeName: string;
  scopeVersion?: string;
  traceId: string;
  spanId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  sessionId: string;
  redactionApplied: boolean;
  endUnixNano: string;
  extraAttributes?: OtlpAttribute[];
  errorMessage?: string;
}

export interface OtlpTracePayload {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: Array<Record<string, unknown>>;
    }>;
  }>;
}

export interface OtlpLogPayload {
  resourceLogs: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<Record<string, unknown>>;
    }>;
  }>;
}

const JWT_PATTERN = /\b(eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.)([A-Za-z0-9_-]{8,})\b/g;

export function redactJwtSignatures(input: string): { redacted: string; changed: boolean } {
  let changed = false;
  const redacted = input.replace(JWT_PATTERN, (_m, prefix) => {
    changed = true;
    return `${prefix}***REDACTED***`;
  });
  return { redacted, changed };
}

export function hasJwtSignature(input: string | null | undefined): boolean {
  if (!input) return false;
  return new RegExp(JWT_PATTERN.source).test(input);
}

export function redactAuthHeader(rawAuth: string | null | undefined): RedactAuthResult {
  if (!rawAuth) {
    return { redacted: null, changed: false };
  }
  const trimmed = rawAuth.trim();
  if (!trimmed) {
    return { redacted: null, changed: false };
  }

  const jwtResult = redactJwtSignatures(trimmed);
  if (jwtResult.changed) {
    return { redacted: jwtResult.redacted, changed: true };
  }

  const schemeMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s+(.+)$/);
  if (schemeMatch) {
    return { redacted: `${schemeMatch[1]} ***REDACTED***`, changed: true };
  }

  return { redacted: '***REDACTED***', changed: true };
}

export function buildOtlpHeaders(env: OtlpEnv): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (env.OTLP_AUTH_HEADER) {
    headers['Authorization'] = env.OTLP_AUTH_HEADER;
  }
  return headers;
}

export function buildResourceAttributes(serviceName: string, environment?: string): OtlpAttribute[] {
  return [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'deployment.environment', value: { stringValue: environment || 'production' } }
  ];
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

export function buildOtlpTracePayload(input: OtlpTraceInput): OtlpTracePayload {
  const parentSpanId =
    input.parentSpanId && input.parentSpanId !== '0000000000000000'
      ? input.parentSpanId
      : undefined;

  const sanitizedError = input.errorMessage
    ? redactJwtSignatures(input.errorMessage).redacted
    : undefined;

  const attributes: OtlpAttribute[] = [
    { key: 'http.method', value: { stringValue: input.method } },
    { key: 'http.target', value: { stringValue: input.path } },
    { key: 'http.status_code', value: { intValue: input.status } },
    { key: '0trust.session_id', value: { stringValue: input.sessionId } },
    { key: '0trust.latency_ms', value: { intValue: input.latencyMs } },
    { key: '0trust.redaction_applied', value: { boolValue: input.redactionApplied } },
    ...(sanitizedError ? [{ key: 'error.message', value: { stringValue: sanitizedError } }] : []),
    ...(input.extraAttributes ?? [])
  ];

  const span: Record<string, unknown> = {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name: `${input.method} ${input.path}`,
    kind: 2,
    startTimeUnixNano: input.startUnixNano,
    endTimeUnixNano: input.endUnixNano,
    attributes,
    status: {
      code: input.status >= 500 ? 2 : 1,
      ...(sanitizedError ? { message: sanitizedError } : {})
    }
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: buildResourceAttributes(input.serviceName, input.environment)
        },
        scopeSpans: [
          {
            scope: { name: input.scopeName, version: input.scopeVersion || '1.0.0' },
            spans: [span]
          }
        ]
      }
    ]
  };
}

export function buildOtlpLogPayload(input: OtlpLogInput): OtlpLogPayload {
  const { severityNumber, severityText } = mapStatusToSeverity(input.status);
  const message = `${input.method} ${input.path} -> ${input.status} (${input.latencyMs}ms)`;

  const buildBody = (redactionApplied: boolean) =>
    JSON.stringify({
      message,
      session_id: input.sessionId,
      method: input.method,
      path: input.path,
      status: input.status,
      latency_ms: input.latencyMs,
      redaction_applied: redactionApplied,
      trace_id: input.traceId,
      span_id: input.spanId,
      ...(input.errorMessage ? { error: input.errorMessage } : {})
    });

  const initialRedaction = redactJwtSignatures(buildBody(input.redactionApplied));
  const redactionApplied = input.redactionApplied || initialRedaction.changed;
  const finalBody =
    redactionApplied && !input.redactionApplied
      ? redactJwtSignatures(buildBody(true)).redacted
      : initialRedaction.redacted;

  const sanitizedError = input.errorMessage
    ? redactJwtSignatures(input.errorMessage).redacted
    : undefined;

  const attributes: OtlpAttribute[] = [
    { key: '0trust.session_id', value: { stringValue: input.sessionId } },
    { key: 'http.method', value: { stringValue: input.method } },
    { key: 'http.target', value: { stringValue: input.path } },
    { key: 'http.status_code', value: { intValue: input.status } },
    { key: '0trust.latency_ms', value: { intValue: input.latencyMs } },
    { key: '0trust.redaction_applied', value: { boolValue: redactionApplied } },
    { key: 'trace_id', value: { stringValue: input.traceId } },
    { key: 'span_id', value: { stringValue: input.spanId } },
    ...(sanitizedError ? [{ key: 'error.message', value: { stringValue: sanitizedError } }] : []),
    ...(input.extraAttributes ?? [])
  ];

  return {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(input.serviceName, input.environment)
        },
        scopeLogs: [
          {
            scope: { name: input.scopeName, version: input.scopeVersion || '1.0.0' },
            logRecords: [
              {
                timeUnixNano: input.endUnixNano,
                observedTimeUnixNano: input.endUnixNano,
                severityNumber,
                severityText,
                traceId: input.traceId,
                spanId: input.spanId,
                body: { stringValue: finalBody },
                attributes
              }
            ]
          }
        ]
      }
    ]
  };
}

export async function postOtlpPayload(
  env: OtlpEnv,
  path: '/v1/traces' | '/v1/logs',
  payload: unknown
): Promise<void> {
  const endpointBase = env.OTLP_ENDPOINT?.trim();
  if (!endpointBase) return;
  const endpoint = `${endpointBase.replace(/\/$/, '')}${path}`;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: buildOtlpHeaders(env),
      body: JSON.stringify(payload)
    });
  } catch {
    // Non-blocking best-effort OTLP export; never fail user request
  }
}
