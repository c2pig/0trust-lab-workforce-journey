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

const JWT_PATTERN = /\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.)([A-Za-z0-9_-]+)\b/g;

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
  return /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(input);
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

export function buildResourceAttributes(serviceName: string, environment?: string) {
  return [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'deployment.environment', value: { stringValue: environment || 'production' } }
  ];
}

export async function postOtlpPayload(
  env: OtlpEnv,
  path: '/v1/traces' | '/v1/logs',
  payload: unknown
): Promise<void> {
  if (!env.OTLP_ENDPOINT) return;
  const endpoint = `${env.OTLP_ENDPOINT.replace(/\/$/, '')}${path}`;
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
