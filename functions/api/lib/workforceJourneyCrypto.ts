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

async function importHmacKey(secret?: string): Promise<CryptoKey> {
  const rawSecret = secret && secret.length >= 16 ? secret : DEFAULT_DEMO_HMAC_SECRET;
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
  secret?: string
): Promise<{ token: string; header: WorkforceJourneyJwtHeader; payload: WorkforceJourneyJwtPayload }> {
  const header: WorkforceJourneyJwtHeader = {
    alg: 'HS256',
    typ: 'JWT',
    kid: '0trust-edge-hs256-v1'
  };
  const headerB64 = encodeJsonBase64Url(header);
  const payloadB64 = encodeJsonBase64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importHmacKey(secret);
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
  secret?: string
): Promise<{ valid: boolean; error?: string; decoded?: DecodedWorkforceJourneyJwt }> {
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

    const key = await importHmacKey(secret);
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
