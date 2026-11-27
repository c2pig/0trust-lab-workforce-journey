import {
  WorkforceJourneyDecodedJwt,
  WorkforceJourneyJitDecisionAction,
  WorkforceJourneyJitDecisionData,
  WorkforceJourneyJitRequestRecord,
  WorkforceJourneyJitSubmitData,
  WorkforceJourneyPersonaId,
  WorkforceJourneyRole,
  WorkforceJourneyScimRecord,
  ObservabilitySpan
} from '../types';

export type {
  WorkforceJourneyJitDecisionAction,
  WorkforceJourneyJitDecisionData,
  WorkforceJourneyJitRequestRecord,
  WorkforceJourneyJitSubmitData
};

export interface WorkforceJourneyApiCallResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  span: ObservabilitySpan;
}

export interface WorkforceJourneyConfig {
  sandbox_available: boolean;
  entra_external_id_configured: boolean;
  pam_api_configured: boolean;
  privileged_group_configured: boolean;
}

export interface WorkforceJourneyProvisionData {
  status?: string;
  error?: string;
  rule_id?: string;
  message?: string;
  conflicting_roles?: string[];
  persona?: { id: string; name: string; email: string; department: string };
  roles?: string[];
  session_jwt?: string;
  approver_jwt?: string;
  decoded_claims?: WorkforceJourneyDecodedJwt;
  scim_record?: WorkforceJourneyScimRecord;
  idp_mode?: string;
  storage?: string;
  external_sync?: string;
  graph_request_id?: string;
}

export interface WorkforceJourneyJitData {
  status?: string;
  error?: string;
  code?: string;
  message?: string;
  policy?: string;
  justification?: string;
  expires_in?: number;
  jit_jwt?: string;
  decoded_claims?: WorkforceJourneyDecodedJwt;
  scim_record?: WorkforceJourneyScimRecord;
  idp_mode?: string;
  external_sync?: string;
  graph_request_id?: string;
  pam_api_status?: string;
}

export type WorkforceJourneyTargetEndpoint = 'ledger_read' | 'payment_create' | 'payment_approve';

export interface WorkforceJourneyProtectedData {
  status?: string;
  error?: string;
  code?: string;
  message?: string;
  http_status?: number;
  resource?: string;
  required_role?: string;
  action?: string;
  actor?: string;
  roles?: string[];
  scope?: string;
  jti?: string;
  remaining_seconds?: number;
  verified_checks?: string[];
}

export interface WorkforceJourneyLogoutData {
  status?: string;
  error?: string;
  session_id?: string;
  revoked_jtis?: string[];
  caep_event?: Record<string, unknown>;
  scim_record?: WorkforceJourneyScimRecord;
  idp_mode?: string;
  storage?: string;
  external_sync?: string;
  graph_request_id?: string;
}

let edgeApiAvailable: boolean | null = null;
let edgeConfigProbePromise: Promise<WorkforceJourneyConfig> | null = null;

export async function fetchWorkforceJourneyConfig(): Promise<WorkforceJourneyConfig> {
  const probe = (async () => {
    try {
      const res = await fetch('/api/workforce-journey/config', { cache: 'no-store' });
      const ct = res.headers.get('Content-Type') || '';
      if (res.ok && ct.includes('application/json')) {
        edgeApiAvailable = true;
        return (await res.json()) as WorkforceJourneyConfig;
      }
      if (typeof window !== 'undefined') {
        edgeApiAvailable = false;
      }
    } catch {
      // Fallback when running static Vite dev
      if (typeof window !== 'undefined') {
        edgeApiAvailable = false;
      }
    }
    return {
      sandbox_available: true,
      entra_external_id_configured: false,
      pam_api_configured: false,
      privileged_group_configured: false
    };
  })();

  edgeConfigProbePromise = probe;
  try {
    return await probe;
  } finally {
    if (edgeConfigProbePromise === probe) {
      edgeConfigProbePromise = null;
    }
  }
}

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createVisitorSessionId(): string {
  return `vis_${randomHex(6)}`;
}

function generateClientTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function redactJwtInAuth(authHeader: string | null): { redacted: string | null; changed: boolean } {
  if (!authHeader) return { redacted: null, changed: false };
  let changed = false;
  const redacted = authHeader.replace(
    /\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.)([A-Za-z0-9_-]+)\b/g,
    (_m, prefix) => {
      changed = true;
      return `${prefix}***REDACTED***`;
    }
  );
  return { redacted, changed };
}

function redactSummary(data: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...data };
  delete clone._telemetry;
  for (const key of ['session_jwt', 'jit_jwt']) {
    if (typeof clone[key] === 'string') {
      clone[key] = redactJwtInAuth(clone[key] as string).redacted;
    }
  }
  return clone;
}

// ============================================================================
// Browser WebCrypto Fallback (only used if Cloudflare Functions are not mounted,
// e.g. plain `vite dev` without `wrangler pages dev`)
// ============================================================================
const FALLBACK_KEY = '0trust-dev-lab1-ephemeral-hmac-key-v1';
const fallbackDirStore = new Map<string, WorkforceJourneyScimRecord>();
const fallbackRevokedSet = new Set<string>();
const fallbackJitReqStore = new Map<string, WorkforceJourneyJitRequestRecord>();

export function resetBrowserFallbackSession(sessionId?: string): void {
  if (!sessionId) {
    fallbackDirStore.clear();
    fallbackRevokedSet.clear();
    fallbackJitReqStore.clear();
    return;
  }
  fallbackDirStore.delete(sessionId);
  const prefix = `${sessionId}:`;
  for (const key of Array.from(fallbackRevokedSet)) {
    if (key.startsWith(prefix)) fallbackRevokedSet.delete(key);
  }
  for (const key of Array.from(fallbackJitReqStore.keys())) {
    if (key.startsWith(prefix)) fallbackJitReqStore.delete(key);
  }
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fallbackSignJwt(payload: Record<string, unknown>): Promise<{
  token: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}> {
  const header = { alg: 'HS256', typ: 'JWT', kid: '0trust-browser-hs256-fallback' };
  const h = toB64Url(new TextEncoder().encode(JSON.stringify(header)));
  const p = toB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(FALLBACK_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`));
  return { token: `${h}.${p}.${toB64Url(new Uint8Array(sig))}`, header, payload };
}

async function fallbackVerifyJwt(token: string): Promise<{
  valid: boolean;
  error?: string;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}> {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return { valid: false, error: 'Malformed JWT.' };
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(FALLBACK_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      fromB64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return { valid: false, error: 'Invalid JWT signature (WebCrypto HMAC-SHA256 mismatch).' };
    return { valid: true, header, payload };
  } catch {
    return { valid: false, error: 'Failed to decode JWT.' };
  }
}

const PERSONAS: Record<WorkforceJourneyPersonaId, { id: string; name: string; email: string; department: string }> = {
  'alex-chen': { id: 'alex-chen', name: 'Alex Chen', email: 'alex.chen@acme-corp.io', department: 'Finance Operations' },
  'sarah-lin': { id: 'sarah-lin', name: 'Sarah Lin', email: 'sarah.lin@acme-corp.io', department: 'Payments Engineering' },
  'jordan-patel': { id: 'jordan-patel', name: 'Jordan Patel', email: 'jordan.patel@acme-corp.io', department: 'Security Audit' },
  'maya-lin': { id: 'maya-lin', name: 'Maya Lin', email: 'maya.lin@acme-corp.io', department: 'Finance Operations' },
  'marcus-chen': { id: 'marcus-chen', name: 'Marcus Chen', email: 'marcus.chen@acme-corp.io', department: 'Finance Management' },
  'priya-nair': { id: 'priya-nair', name: 'Priya Nair', email: 'priya.nair@acme-corp.io', department: 'SecOps & IAM' }
};

const VALID_ROLES = new Set(['Viewer', 'Payment Creator', 'Audit Approver']);
const MAX_JIT_TTL_SECONDS = 900;
const MIN_JIT_TTL_SECONDS = 60;

async function runBrowserFallback(
  path: string,
  body: Record<string, unknown>,
  authHeader: string | null,
  sessionId: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  const nowSec = Math.floor(Date.now() / 1000);

  if (path === '/api/workforce-journey/login-provision') {
    const persona = PERSONAS[(body.personaId as WorkforceJourneyPersonaId) || 'alex-chen'] || PERSONAS['alex-chen'];
    const roles = (body.roles as string[]) || [];
    if (roles.length === 0) {
      return { status: 400, data: { error: 'ROLES_REQUIRED', message: 'Select at least one role.' } };
    }
    if (roles.includes('Payment Creator') && roles.includes('Audit Approver')) {
      return {
        status: 403,
        data: {
          error: 'SOD_CONFLICT',
          rule_id: 'SOD-FIN-001',
          message: 'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
          conflicting_roles: ['Payment Creator', 'Audit Approver']
        }
      };
    }
    const jti = `sess_${randomHex(6)}`;
    const scim: WorkforceJourneyScimRecord = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: `scim_${persona.id}`,
      userName: persona.email,
      displayName: persona.name,
      department: persona.department,
      active: true,
      status: 'ACTIVE',
      roles,
      active_jtis: [jti],
      provisioned_at: new Date().toISOString(),
      idp_adapter: 'edge-webcrypto'
    };
    fallbackDirStore.set(sessionId, scim);
    const signed = await fallbackSignJwt({
      iss: 'https://iam.0trust.dev',
      sub: persona.id,
      email: persona.email,
      name: persona.name,
      department: persona.department,
      roles,
      scope: 'session:base',
      token_type: 'session',
      jti,
      sid: sessionId,
      iat: nowSec,
      exp: nowSec + 3600
    });
    const approverSigned = await fallbackSignJwt({
      iss: 'https://iam.0trust.dev',
      sub: 'marcus-chen',
      email: 'marcus.chen@acme-corp.io',
      name: 'Marcus Chen',
      department: 'Finance Management',
      roles: ['Audit Approver'],
      scope: 'pam:approve',
      token_type: 'session',
      jti: `apprv_${randomHex(6)}`,
      sid: sessionId,
      iat: nowSec,
      exp: nowSec + 3600
    });
    return {
      status: 200,
      data: {
        status: 'PROVISIONED',
        persona,
        roles,
        session_jwt: signed.token,
        approver_jwt: approverSigned.token,
        decoded_claims: { header: signed.header, payload: signed.payload },
        scim_record: scim,
        idp_mode: 'edge-webcrypto',
        storage: 'browser-fallback',
        external_sync: 'Browser WebCrypto Fallback (Edge Functions active on 0trust.dev)'
      }
    };
  }

  if (path === '/api/workforce-journey/request-jit') {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { status: 401, data: { error: 'MISSING_SESSION_TOKEN', message: 'Authorization Bearer token required.' } };
    const v = await fallbackVerifyJwt(token);
    if (!v.valid || !v.payload) return { status: 401, data: { error: 'INVALID_SESSION_TOKEN', message: v.error } };
    const p = v.payload;
    if (typeof p.exp !== 'number' || Number(p.exp) <= nowSec) {
      return { status: 401, data: { error: 'SESSION_EXPIRED', message: 'Session token has expired. Re-provision in Step 1.' } };
    }
    if (p.token_type !== 'session') return { status: 403, data: { error: 'INVALID_TOKEN_TYPE', message: 'Expected Step 1 Session Token.' } };
    if (typeof p.sid === 'string' && p.sid && p.sid !== sessionId) {
      return {
        status: 403,
        data: {
          error: 'SESSION_MISMATCH',
          message: 'Session token does not belong to this visitor session.'
        }
      };
    }
    const tokenSid = typeof p.sid === 'string' && p.sid ? p.sid : sessionId;
    const dir = fallbackDirStore.get(sessionId);
    const tokenDir = tokenSid !== sessionId ? fallbackDirStore.get(tokenSid) : dir;
    if (
      fallbackRevokedSet.has(`${sessionId}:${String(p.jti)}`) ||
      fallbackRevokedSet.has(`${tokenSid}:${String(p.jti)}`) ||
      dir?.status === 'REVOKED' ||
      tokenDir?.status === 'REVOKED'
    ) {
      return { status: 401, data: { error: 'TOKEN_REVOKED', code: 'CAEP_SESSION_REVOKED', message: 'Session token revoked.' } };
    }
    const jitJti = `jit_${randomHex(6)}`;
    const signed = await fallbackSignJwt({
      ...p,
      iss: 'https://pam.0trust.dev',
      scope: 'admin:temp',
      token_type: 'jit_elevated',
      jti: jitJti,
      elevated_from_jti: p.jti,
      iat: nowSec,
      exp: nowSec + 900
    });
    if (dir && !dir.active_jtis.includes(jitJti)) dir.active_jtis.push(jitJti);
    return {
      status: 200,
      data: {
        status: 'JIT_GRANTED',
        policy: 'IAM-JIT-15M',
        justification: body.justification || 'Emergency production payment audit',
        expires_in: 900,
        jit_jwt: signed.token,
        decoded_claims: { header: signed.header, payload: signed.payload },
        scim_record: dir
      }
    };
  }

  if (path === '/api/workforce-journey/jit-submit') {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return {
        status: 401,
        data: {
          error: 'MISSING_SESSION_TOKEN',
          message: 'Present your Base Session Token in the Authorization: Bearer <session_jwt> header.'
        }
      };
    }

    const v = await fallbackVerifyJwt(token);
    if (!v.valid || !v.payload) {
      return {
        status: 401,
        data: {
          error: 'INVALID_SESSION_TOKEN',
          message: v.error || 'Session token signature verification failed.'
        }
      };
    }

    const p = v.payload;
    if (typeof p.exp !== 'number' || Number(p.exp) <= nowSec) {
      return {
        status: 401,
        data: {
          error: 'SESSION_EXPIRED',
          message: 'Session token has expired. Re-provision a fresh base session.'
        }
      };
    }

    if (p.token_type !== 'session') {
      return {
        status: 403,
        data: {
          error: 'INVALID_TOKEN_TYPE',
          message: 'Expected a Base Session Token (token_type: session).'
        }
      };
    }

    if (typeof p.sid === 'string' && p.sid && p.sid !== sessionId) {
      return {
        status: 403,
        data: {
          error: 'SESSION_MISMATCH',
          message: 'Session token does not belong to this visitor session.'
        }
      };
    }

    const dir = fallbackDirStore.get(sessionId);
    if (fallbackRevokedSet.has(`${sessionId}:${String(p.jti)}`) || dir?.status === 'REVOKED') {
      return {
        status: 401,
        data: {
          error: 'TOKEN_REVOKED',
          code: 'CAEP_SESSION_REVOKED',
          message: 'Session token has been revoked via Universal Logout (CAEP).'
        }
      };
    }

    const existingRoles = Array.isArray(p.roles) ? (p.roles as string[]) : [];
    const rawRequested = Array.isArray(body.requested_roles)
      ? body.requested_roles
      : Array.isArray(body.roles)
        ? body.roles
        : null;

    const validatedRequested = rawRequested
      ? rawRequested.filter((r): r is string => typeof r === 'string' && VALID_ROLES.has(r))
      : [];

    if (rawRequested && rawRequested.length > 0 && validatedRequested.length !== rawRequested.length) {
      const invalid = rawRequested.filter((r) => typeof r !== 'string' || !VALID_ROLES.has(r));
      return {
        status: 400,
        data: {
          error: 'INVALID_ROLES',
          invalid_roles: invalid,
          message: `Unsupported role(s): ${invalid.join(', ')}. Allowed roles: Viewer, Payment Creator, Audit Approver.`
        }
      };
    }

    const requestedRoles =
      validatedRequested.length > 0 ? Array.from(new Set(validatedRequested)) : [...existingRoles];

    const effectiveRoles = Array.from(new Set([...existingRoles, ...requestedRoles]));
    if (effectiveRoles.includes('Payment Creator') && effectiveRoles.includes('Audit Approver')) {
      return {
        status: 403,
        data: {
          error: 'SOD_CONFLICT',
          rule_id: 'SOD-FIN-001',
          message:
            'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
          conflicting_roles: ['Payment Creator', 'Audit Approver'],
          existing_roles: existingRoles,
          requested_roles: requestedRoles
        }
      };
    }

    if (body.permanent === true) {
      return {
        status: 400,
        data: {
          error: 'ZSP_MAX_TTL_EXCEEDED',
          policy: 'IAM-ZSP-MAX-15M',
          max_ttl_seconds: MAX_JIT_TTL_SECONDS,
          requested_ttl_seconds:
            typeof body.ttl_seconds === 'number' && Number.isFinite(body.ttl_seconds)
              ? body.ttl_seconds
              : null,
          message:
            'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
        }
      };
    }

    if (body.ttl_seconds !== undefined) {
      if (typeof body.ttl_seconds !== 'number' || !Number.isFinite(body.ttl_seconds)) {
        return {
          status: 400,
          data: {
            error: 'INVALID_TTL',
            message: 'ttl_seconds must be between 60 and 900 seconds.'
          }
        };
      }
      if (body.ttl_seconds > MAX_JIT_TTL_SECONDS) {
        return {
          status: 400,
          data: {
            error: 'ZSP_MAX_TTL_EXCEEDED',
            policy: 'IAM-ZSP-MAX-15M',
            max_ttl_seconds: MAX_JIT_TTL_SECONDS,
            requested_ttl_seconds: body.ttl_seconds,
            message:
              'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
          }
        };
      }
      if (body.ttl_seconds < MIN_JIT_TTL_SECONDS) {
        return {
          status: 400,
          data: {
            error: 'INVALID_TTL',
            message: 'ttl_seconds must be between 60 and 900 seconds.'
          }
        };
      }
    }

    const ttlSeconds =
      typeof body.ttl_seconds === 'number' ? Math.floor(body.ttl_seconds) : MAX_JIT_TTL_SECONDS;
    const requestId = `REQ-${randomHex(4).toUpperCase()}`;
    const nowIso = new Date().toISOString();
    const justification =
      typeof body.justification === 'string' && body.justification.trim()
        ? body.justification.trim()
        : 'Q4 Ledger Close — Export & reconcile treasury batch (INC-4821)';

    const record: WorkforceJourneyJitRequestRecord = {
      request_id: requestId,
      session_id: sessionId,
      status: 'PENDING',
      requester: {
        sub: String(p.sub || ''),
        email: String(p.email || ''),
        name: String(p.name || ''),
        department: String(p.department || ''),
        base_roles: existingRoles,
        session_jti: String(p.jti || ''),
        entra_oid: dir?.entra_oid
      },
      requested_roles: requestedRoles,
      requested_scope: 'admin:temp',
      justification,
      ttl_seconds: ttlSeconds,
      sod_check: {
        rule_id: 'SOD-FIN-001',
        status: 'PASS',
        checked_at: nowIso
      },
      idp_mode: 'edge-webcrypto',
      created_at: nowIso
    };

    fallbackJitReqStore.set(`${sessionId}:${requestId}`, record);

    return {
      status: 201,
      data: {
        status: 'PENDING',
        request_id: requestId,
        sod_status: 'PASS',
        rule_id: 'SOD-FIN-001',
        ttl_seconds: ttlSeconds,
        kv_ttl_seconds: 3600,
        storage: 'browser-fallback',
        idp_mode: 'edge-webcrypto',
        request: record
      }
    };
  }

  if (path === '/api/workforce-journey/jit-decision') {
    const approverToken = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!approverToken) {
      return {
        status: 401,
        data: {
          error: 'MISSING_APPROVER_TOKEN',
          message: 'Authorization: Bearer <approver_jwt> header is required.'
        }
      };
    }
    const verifiedApprover = await fallbackVerifyJwt(approverToken);
    if (!verifiedApprover.valid || !verifiedApprover.payload) {
      return {
        status: 401,
        data: {
          error: 'INVALID_APPROVER_TOKEN',
          message: verifiedApprover.error || 'Approver token verification failed.'
        }
      };
    }
    const approverClaims = verifiedApprover.payload;
    const approverRoles = Array.isArray(approverClaims.roles) ? (approverClaims.roles as string[]) : [];
    if (!approverRoles.includes('Audit Approver')) {
      return {
        status: 403,
        data: {
          error: 'APPROVER_ROLE_REQUIRED',
          message: 'Approver token must include the "Audit Approver" role.'
        }
      };
    }

    const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
    if (!requestId) {
      return {
        status: 400,
        data: {
          error: 'MISSING_REQUEST_ID',
          message: 'request_id is required.'
        }
      };
    }

    const decision = body.decision;
    if (decision !== 'approve' && decision !== 'deny' && decision !== 'grant_permanent') {
      return {
        status: 400,
        data: {
          error: 'INVALID_DECISION',
          message: 'decision must be one of: approve, deny, grant_permanent.'
        }
      };
    }

    const storeKey = `${sessionId}:${requestId}`;
    const record = fallbackJitReqStore.get(storeKey);
    if (!record) {
      return {
        status: 404,
        data: {
          error: 'REQUEST_NOT_FOUND',
          request_id: requestId,
          message: `JIT request ${requestId} was not found or has expired.`
        }
      };
    }

    if (record.status !== 'PENDING') {
      return {
        status: 409,
        data: {
          error: 'REQUEST_ALREADY_DECIDED',
          status: record.status,
          request_id: requestId,
          message: `JIT request ${requestId} has already been decided (${record.status}).`
        }
      };
    }

    if (decision === 'grant_permanent') {
      return {
        status: 403,
        data: {
          error: 'ZSP_POLICY_VIOLATION',
          policy: 'IAM-ZSP-001',
          request_id: record.request_id,
          message:
            'Zero Standing Privileges Violation: Granting permanent admin access is prohibited. Only time-bound (<= 15m) JIT elevation is permitted.'
        }
      };
    }

    const dir = fallbackDirStore.get(sessionId);
    if (
      fallbackRevokedSet.has(`${sessionId}:${record.requester.session_jti}`) ||
      dir?.status === 'REVOKED'
    ) {
      return {
        status: 401,
        data: {
          error: 'TOKEN_REVOKED',
          code: 'CAEP_SESSION_REVOKED',
          request_id: record.request_id,
          message: 'Requester session has been revoked via Universal Logout (CAEP).'
        }
      };
    }

    const approverEmail = typeof approverClaims.email === 'string' ? approverClaims.email.trim() : '';
    const approverName = typeof approverClaims.name === 'string' && approverClaims.name.trim()
      ? approverClaims.name.trim()
      : 'Audit Approver';
    if (!approverEmail || approverEmail.toLowerCase() === record.requester.email.toLowerCase()) {
      return {
        status: 403,
        data: {
          error: 'SELF_APPROVAL_FORBIDDEN',
          request_id: record.request_id,
          message: 'Requester cannot approve their own JIT elevation request.'
        }
      };
    }

    const effectiveRoles = Array.from(
      new Set([...(record.requester.base_roles || []), ...(record.requested_roles || [])])
    );
    if (effectiveRoles.includes('Payment Creator') && effectiveRoles.includes('Audit Approver')) {
      return {
        status: 403,
        data: {
          error: 'SOD_CONFLICT',
          rule_id: 'SOD-FIN-001',
          request_id: record.request_id,
          message:
            'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
          conflicting_roles: ['Payment Creator', 'Audit Approver']
        }
      };
    }

    if (
      !Number.isFinite(record.ttl_seconds) ||
      record.ttl_seconds > MAX_JIT_TTL_SECONDS ||
      record.ttl_seconds < MIN_JIT_TTL_SECONDS
    ) {
      return {
        status: 400,
        data: {
          error: 'ZSP_MAX_TTL_EXCEEDED',
          policy: 'IAM-ZSP-MAX-15M',
          max_ttl_seconds: MAX_JIT_TTL_SECONDS,
          requested_ttl_seconds: record.ttl_seconds,
          message:
            'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
        }
      };
    }

    const nowIso = new Date().toISOString();

    if (decision === 'deny') {
      const reason =
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'Denied by approver';
      const updatedRecord: WorkforceJourneyJitRequestRecord = {
        ...record,
        status: 'DENIED',
        decided_at: nowIso,
        decided_by: approverEmail,
        decision_reason: reason
      };
      fallbackJitReqStore.set(storeKey, updatedRecord);
      return {
        status: 200,
        data: {
          status: 'JIT_DENIED',
          request_id: updatedRecord.request_id,
          denied_by: approverEmail,
          denied_by_name: approverName,
          reason,
          storage: 'browser-fallback',
          idp_mode: 'edge-webcrypto',
          request: updatedRecord
        }
      };
    }

    const ttlSeconds = Math.max(
      MIN_JIT_TTL_SECONDS,
      Math.min(MAX_JIT_TTL_SECONDS, Math.floor(record.ttl_seconds || MAX_JIT_TTL_SECONDS))
    );
    const jitJti = `jit_${randomHex(6)}`;
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Approved by manager';

    if (dir && !dir.active_jtis.includes(jitJti)) {
      dir.active_jtis.push(jitJti);
    }

    const updatedRecord: WorkforceJourneyJitRequestRecord = {
      ...record,
      status: 'APPROVED',
      decided_at: nowIso,
      decided_by: approverEmail,
      decision_reason: reason,
      jit_jti: jitJti
    };
    fallbackJitReqStore.set(storeKey, updatedRecord);

    const signedJit = await fallbackSignJwt({
      iss: 'https://pam.0trust.dev',
      sub: record.requester.sub,
      email: record.requester.email,
      name: record.requester.name,
      department: record.requester.department,
      roles: effectiveRoles,
      scope: 'admin:temp',
      token_type: 'jit_elevated',
      jti: jitJti,
      sid: sessionId,
      elevated_from_jti: record.requester.session_jti,
      approved_by: approverEmail,
      request_id: record.request_id,
      iat: nowSec,
      exp: nowSec + ttlSeconds
    });

    return {
      status: 200,
      data: {
        status: 'JIT_GRANTED',
        policy: 'IAM-JIT-15M',
        request_id: updatedRecord.request_id,
        approved_by: approverEmail,
        approved_by_name: approverName,
        justification: updatedRecord.justification,
        expires_in: ttlSeconds,
        jit_jwt: signedJit.token,
        decoded_claims: { header: signedJit.header, payload: signedJit.payload },
        scim_record: dir || null,
        idp_mode: 'edge-webcrypto',
        storage: 'browser-fallback',
        external_sync: 'Browser WebCrypto Fallback (Edge Functions active on 0trust.dev)',
        request: updatedRecord
      }
    };
  }

  if (path === '/api/workforce-journey/protected-call') {
    const endpointRules: Record<WorkforceJourneyTargetEndpoint, { resource: string; requiredRoles: string[]; requiredLabel: string }> = {
      ledger_read: { resource: 'GET /api/v1/ledger/read', requiredRoles: ['Viewer', 'Payment Creator', 'Audit Approver'], requiredLabel: 'Viewer' },
      payment_create: { resource: 'POST /api/v1/payments/create', requiredRoles: ['Payment Creator'], requiredLabel: 'Payment Creator' },
      payment_approve: { resource: 'POST /api/v1/payments/approve', requiredRoles: ['Audit Approver'], requiredLabel: 'Audit Approver' }
    };
    const ep = (body.target_endpoint as WorkforceJourneyTargetEndpoint) in endpointRules
      ? (body.target_endpoint as WorkforceJourneyTargetEndpoint)
      : 'ledger_read';
    const rule = endpointRules[ep];

    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { status: 401, data: { error: 'MISSING_BEARER_TOKEN', resource: rule.resource, message: 'Authorization Bearer token required.' } };
    const v = await fallbackVerifyJwt(token);
    if (!v.valid || !v.payload) return { status: 401, data: { error: 'INVALID_TOKEN', resource: rule.resource, message: v.error } };
    const p = v.payload;
    if (typeof p.sid === 'string' && p.sid && p.sid !== sessionId) {
      return {
        status: 403,
        data: {
          error: 'SESSION_MISMATCH',
          resource: rule.resource,
          message: 'Token does not belong to this visitor session.'
        }
      };
    }
    const tokenSid = typeof p.sid === 'string' && p.sid ? p.sid : sessionId;
    const dir = fallbackDirStore.get(sessionId);
    const tokenDir = tokenSid !== sessionId ? fallbackDirStore.get(tokenSid) : dir;
    if (
      fallbackRevokedSet.has(`${sessionId}:${String(p.jti)}`) ||
      fallbackRevokedSet.has(`${tokenSid}:${String(p.jti)}`) ||
      (typeof p.elevated_from_jti === 'string' &&
        (fallbackRevokedSet.has(`${sessionId}:${p.elevated_from_jti}`) ||
          fallbackRevokedSet.has(`${tokenSid}:${p.elevated_from_jti}`))) ||
      dir?.status === 'REVOKED' ||
      tokenDir?.status === 'REVOKED'
    ) {
      return {
        status: 401,
        data: {
          error: 'TOKEN_REVOKED',
          code: 'CAEP_SESSION_REVOKED',
          resource: rule.resource,
          jti: p.jti,
          message: 'HTTP 401 Revoked: Session was terminated by Universal Logout (OpenID CAEP).'
        }
      };
    }
    if (body.simulate_expired || Number(p.exp) <= nowSec) {
      return {
        status: 401,
        data: {
          error: 'TOKEN_EXPIRED',
          resource: rule.resource,
          jti: p.jti,
          message: 'HTTP 401 Expired: 15-minute JIT elevation window has elapsed.'
        }
      };
    }
    if (p.scope !== 'admin:temp' || p.token_type !== 'jit_elevated') {
      return { status: 403, data: { error: 'INSUFFICIENT_SCOPE', resource: rule.resource, message: 'Standing privilege denied. Present 15m JIT token.' } };
    }
    const rolesArr = Array.isArray(p.roles) ? (p.roles as string[]) : [];
    if (!rolesArr.some((r) => rule.requiredRoles.includes(r))) {
      return {
        status: 403,
        data: {
          error: 'ROLE_DENIED',
          resource: rule.resource,
          required_role: rule.requiredLabel,
          token_roles: rolesArr,
          message: `HTTP 403 Forbidden: Token lacks required role "${rule.requiredLabel}".`
        }
      };
    }
    return {
      status: 200,
      data: {
        status: 'AUTHORIZED',
        http_status: 200,
        resource: rule.resource,
        required_role: rule.requiredLabel,
        action: body.action || ep.toUpperCase(),
        actor: p.email,
        roles: rolesArr,
        scope: p.scope,
        jti: p.jti,
        remaining_seconds: Math.max(0, Number(p.exp) - nowSec),
        verified_checks: [
          'WebCrypto HMAC-SHA256 signature valid',
          'Revocation check: NOT REVOKED',
          'Token exp > now (within 15m JIT window)',
          'Scope == admin:temp (JIT elevated)',
          `RBAC role check: "${rule.requiredLabel}" present`
        ]
      }
    };
  }

  if (path === '/api/workforce-journey/logout') {
    const bearerTok = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!bearerTok) {
      return {
        status: 401,
        data: {
          error: 'MISSING_SESSION_TOKEN',
          message: 'Authorization: Bearer <jwt> header is required to trigger Universal Logout.'
        }
      };
    }
    const bearerVerified = await fallbackVerifyJwt(bearerTok);
    if (!bearerVerified.valid) {
      return {
        status: 401,
        data: {
          error: 'INVALID_SESSION_TOKEN',
          message: bearerVerified.error || 'Bearer token verification failed.'
        }
      };
    }
    const dir = fallbackDirStore.get(sessionId);
    const revoked: string[] = [];
    let subjectEmail = 'alex.chen@acme-corp.io';
    if (dir) {
      dir.active = false;
      dir.status = 'REVOKED';
      dir.revoked_at = new Date().toISOString();
      if (dir.userName) subjectEmail = dir.userName;
      for (const j of dir.active_jtis) {
        fallbackRevokedSet.add(`${sessionId}:${j}`);
        revoked.push(j);
      }
    }
    for (const tok of [authHeader?.replace(/^Bearer\s+/i, '').trim(), body.session_jwt as string, body.jit_jwt as string]) {
      if (tok) {
        const v = await fallbackVerifyJwt(tok);
        if (v.valid && v.payload?.jti) {
          const j = String(v.payload.jti);
          fallbackRevokedSet.add(`${sessionId}:${j}`);
          if (!revoked.includes(j)) revoked.push(j);
          if (typeof v.payload.elevated_from_jti === 'string') {
            fallbackRevokedSet.add(`${sessionId}:${v.payload.elevated_from_jti}`);
            if (!revoked.includes(v.payload.elevated_from_jti)) revoked.push(v.payload.elevated_from_jti);
          }
          if (!dir && typeof v.payload.email === 'string' && v.payload.email) {
            subjectEmail = v.payload.email;
          }
        }
      }
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Universal Logout triggered by operator / CAEP signal';
    return {
      status: 200,
      data: {
        status: 'UNIVERSAL_LOGOUT_COMPLETE',
        session_id: sessionId,
        revoked_jtis: revoked,
        scim_record: dir || null,
        idp_mode: 'edge-webcrypto',
        storage: 'browser-fallback',
        external_sync: 'Browser WebCrypto Fallback (Edge Functions active on 0trust.dev)',
        caep_event: {
          iss: 'https://iam.0trust.dev',
          jti: `caep_${randomHex(6)}`,
          iat: nowSec,
          events: {
            'https://schemas.openid.net/secevent/caep/event-type/session-revoked': {
              subject: { format: 'email', email: dir?.userName || subjectEmail },
              event_timestamp: nowSec,
              initiating_entity: 'user',
              reason_admin: { en: reason }
            }
          }
        }
      }
    };
  }

  return { status: 404, data: { error: 'NOT_FOUND' } };
}

export async function callWorkforceJourneyApi<T = Record<string, unknown>>(
  path: string,
  options: {
    sessionId: string;
    body?: Record<string, unknown>;
    bearerToken?: string;
  }
): Promise<WorkforceJourneyApiCallResult<T>> {
  const traceparent = generateClientTraceparent();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-Id': options.sessionId,
    traceparent
  };
  if (options.bearerToken) {
    headers['Authorization'] = `Bearer ${options.bearerToken.trim()}`;
  }

  if (typeof window !== 'undefined' && edgeApiAvailable === null && edgeConfigProbePromise) {
    await edgeConfigProbePromise;
  }

  const start = performance.now();

  if (!(typeof window !== 'undefined' && edgeApiAvailable === false)) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...(options.body || {}), sessionId: options.sessionId })
      });

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        if (typeof window !== 'undefined' && edgeApiAvailable === null) {
          edgeApiAvailable = true;
        }
        const json = (await res.json()) as Record<string, unknown>;
        const t = json._telemetry as Record<string, unknown> | undefined;
        const traceParts = traceparent.split('-');
        const span: ObservabilitySpan = {
          id: `span_${randomHex(5)}`,
          traceparent: String(t?.traceparent || traceparent),
          trace_id: String(t?.trace_id || traceParts[1]),
          span_id: String(t?.span_id || traceParts[2]),
          parent_span_id: String(t?.parent_span_id || '0000000000000000'),
          session_id: String(t?.session_id || options.sessionId),
          method: 'POST',
          path,
          status: res.status,
          latency_ms: Number(t?.latency_ms || Math.max(1, Math.round(performance.now() - start))),
          timestamp: String(t?.timestamp || new Date().toISOString()),
          otlp_export: t?.otlp_export === 'configured' ? 'configured' : 'in-lab-only',
          redacted_auth_header:
            typeof t?.redacted_auth_header === 'string'
              ? t.redacted_auth_header
              : redactJwtInAuth(headers['Authorization'] || null).redacted,
          redaction_applied: Boolean(
            t?.redaction_applied ?? redactJwtInAuth(headers['Authorization'] || null).changed
          ),
          execution_origin: 'cloudflare-edge',
          response_summary: redactSummary(json)
        };

        return {
          ok: res.ok,
          status: res.status,
          data: json as T,
          span
        };
      }
      if (typeof window !== 'undefined' && edgeApiAvailable === null) {
        edgeApiAvailable = false;
      }
    } catch {
      // Fall through to browser WebCrypto fallback
      if (typeof window !== 'undefined' && edgeApiAvailable === null) {
        edgeApiAvailable = false;
      }
    }
  }

  const fb = await runBrowserFallback(
    path,
    options.body || {},
    headers['Authorization'] || null,
    options.sessionId
  );
  const traceParts = traceparent.split('-');
  const authRed = redactJwtInAuth(headers['Authorization'] || null);
  const span: ObservabilitySpan = {
    id: `span_${randomHex(5)}`,
    traceparent,
    trace_id: traceParts[1],
    span_id: traceParts[2],
    parent_span_id: '0000000000000000',
    session_id: options.sessionId,
    method: 'POST',
    path,
    status: fb.status,
    latency_ms: Math.max(1, Math.round(performance.now() - start)),
    timestamp: new Date().toISOString(),
    otlp_export: 'in-lab-only',
    redacted_auth_header: authRed.redacted,
    redaction_applied: authRed.changed,
    execution_origin: 'browser-webcrypto-fallback',
    response_summary: redactSummary(fb.data)
  };

  return {
    ok: fb.status >= 200 && fb.status < 300,
    status: fb.status,
    data: fb.data as unknown as T,
    span
  };
}

export interface SubmitWorkforceJitInput {
  sessionId: string;
  sessionJwt: string;
  justification?: string;
  ttlSeconds?: number;
  requestedRoles?: string[];
  permanent?: boolean;
  mode?: 'sandbox' | 'entra-external-id';
}

export async function submitWorkforceJitRequest(
  input: SubmitWorkforceJitInput
): Promise<WorkforceJourneyApiCallResult<WorkforceJourneyJitSubmitData>> {
  return callWorkforceJourneyApi<WorkforceJourneyJitSubmitData>(
    '/api/workforce-journey/jit-submit',
    {
      sessionId: input.sessionId,
      bearerToken: input.sessionJwt,
      body: {
        justification: input.justification,
        ttl_seconds: input.ttlSeconds,
        requested_roles: input.requestedRoles,
        permanent: input.permanent,
        mode: input.mode || 'sandbox'
      }
    }
  );
}

export interface DecideWorkforceJitInput {
  sessionId: string;
  requestId: string;
  decision: WorkforceJourneyJitDecisionAction;
  approverJwt?: string;
  approver?: {
    id?: string;
    name?: string;
    email?: string;
  };
  reason?: string;
  mode?: 'sandbox' | 'entra-external-id';
}

export async function decideWorkforceJitRequest(
  input: DecideWorkforceJitInput
): Promise<WorkforceJourneyApiCallResult<WorkforceJourneyJitDecisionData>> {
  return callWorkforceJourneyApi<WorkforceJourneyJitDecisionData>(
    '/api/workforce-journey/jit-decision',
    {
      sessionId: input.sessionId,
      bearerToken: input.approverJwt,
      body: {
        request_id: input.requestId,
        decision: input.decision,
        approver: input.approver,
        reason: input.reason,
        mode: input.mode || 'sandbox'
      }
    }
  );
}
