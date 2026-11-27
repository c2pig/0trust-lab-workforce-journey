export interface WorkforceJourneyJwtHeader {
  alg: 'HS256';
  typ: 'JWT';
  kid: string;
}

export interface WorkforceJourneyJwtPayload {
  iss: string;
  sub: string;
  email: string;
  name: string;
  department: string;
  roles: string[];
  scope: string;
  token_type: 'session' | 'jit_elevated';
  jti: string;
  sid: string;
  elevated_from_jti?: string;
  approved_by?: string;
  request_id?: string;
  iat: number;
  exp: number;
}

export interface DecodedWorkforceJourneyJwt {
  header: WorkforceJourneyJwtHeader;
  payload: WorkforceJourneyJwtPayload;
  signature: string;
}

const DEFAULT_DEMO_HMAC_SECRET = '0trust-dev-lab1-ephemeral-hmac-key-v1';
export const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KB

function resolveHmacSecret(secret?: string, environment?: string): string {
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (environment === 'production') {
    throw new Error('LAB1_JWT_SECRET must be configured (>= 16 chars) in production.');
  }
  return DEFAULT_DEMO_HMAC_SECRET;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeJsonBase64Url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return toBase64Url(new TextEncoder().encode(json));
}

async function importHmacKey(secret?: string, environment?: string): Promise<CryptoKey> {
  const rawSecret = resolveHmacSecret(secret, environment);
  const keyBytes = new TextEncoder().encode(rawSecret);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signWorkforceJourneyJwt(
  payload: WorkforceJourneyJwtPayload,
  secret?: string,
  environment?: string
): Promise<{ token: string; header: WorkforceJourneyJwtHeader; payload: WorkforceJourneyJwtPayload }> {
  const header: WorkforceJourneyJwtHeader = {
    alg: 'HS256',
    typ: 'JWT',
    kid: '0trust-edge-hs256-v1'
  };
  const headerB64 = encodeJsonBase64Url(header);
  const payloadB64 = encodeJsonBase64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importHmacKey(secret, environment);
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = toBase64Url(new Uint8Array(sigBuffer));

  return {
    token: `${signingInput}.${sigB64}`,
    header,
    payload
  };
}

export async function verifyWorkforceJourneyJwt(
  token: string,
  secret?: string,
  environment?: string
): Promise<{
  valid: boolean;
  expired?: boolean;
  error?: string;
  decoded?: DecodedWorkforceJourneyJwt;
}> {
  const key = await importHmacKey(secret, environment);
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed JWT: expected 3 dot-separated segments.' };
  }

  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const headerJson = new TextDecoder().decode(fromBase64Url(headerB64));
    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64));
    const header = JSON.parse(headerJson) as WorkforceJourneyJwtHeader;
    const payload = JSON.parse(payloadJson) as WorkforceJourneyJwtPayload;

    if (!header || header.alg !== 'HS256') {
      return { valid: false, error: 'Unsupported JWT algorithm: expected HS256.' };
    }

    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = fromBase64Url(sigB64);

    const signatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!signatureValid) {
      return { valid: false, error: 'Invalid JWT signature (WebCrypto HMAC-SHA256 mismatch).' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, error: 'JWT is missing a valid exp claim.' };
    }
    if (payload.exp <= nowSec) {
      return {
        valid: false,
        expired: true,
        error: 'JWT has expired.',
        decoded: { header, payload, signature: sigB64 }
      };
    }

    return {
      valid: true,
      decoded: {
        header,
        payload,
        signature: sigB64
      }
    };
  } catch {
    return { valid: false, error: 'Failed to decode or verify JWT payload.' };
  }
}

export function sanitizeSessionId(raw: string | null | undefined): string {
  if (!raw) return 'demo-visitor';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo-visitor';
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie') || request.headers.get('cookie');
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    if (k === name) {
      const val = pair.slice(idx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

export async function parseJsonBodyWithLimit<T extends Record<string, unknown>>(
  request: Request,
  options?: { allowEmpty?: boolean; maxBytes?: number }
): Promise<
  | { ok: true; body: T }
  | { ok: false; status: number; error: string; message: string }
> {
  const maxBytes = options?.maxBytes ?? MAX_JSON_BODY_BYTES;
  const allowEmpty = options?.allowEmpty ?? false;

  const contentLengthHeader = request.headers.get('Content-Length') || request.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum allowed size of ${maxBytes} bytes.`
      };
    }
  }

  let buf: ArrayBuffer;
  try {
    buf = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_JSON',
      message: 'Failed to read request body.'
    };
  }

  if (buf.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: 'PAYLOAD_TOO_LARGE',
      message: `Request body exceeds maximum allowed size of ${maxBytes} bytes.`
    };
  }

  if (buf.byteLength === 0) {
    if (allowEmpty) {
      return { ok: true, body: {} as T };
    }
    return {
      ok: false,
      status: 400,
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON.'
    };
  }

  try {
    const text = new TextDecoder().decode(buf);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_JSON',
        message: 'Request body must be a JSON object.'
      };
    }
    return { ok: true, body: parsed as T };
  } catch {
    if (allowEmpty) {
      return { ok: true, body: {} as T };
    }
    return {
      ok: false,
      status: 400,
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON.'
    };
  }
}
