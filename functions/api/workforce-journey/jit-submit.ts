import {
  createIdpAdapter,
  JIT_REQUEST_TTL_SECONDS,
  saveJitRequestRecord,
  type JitRequestRecord,
  type WorkforceJourneyEnv
} from '../lib/idpAdapter';
import {
  extractBearerToken,
  parseJsonBodyWithLimit,
  sanitizeSessionId,
  verifyWorkforceJourneyJwt
} from '../lib/workforceJourneyCrypto';

const VALID_ROLES = new Set(['Viewer', 'Payment Creator', 'Audit Approver']);
const MAX_JIT_TTL_SECONDS = 900;
const MIN_JIT_TTL_SECONDS = 60;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  // 1. Bearer presence
  const token = extractBearerToken(context.request);
  if (!token) {
    return jsonResponse(
      {
        error: 'MISSING_SESSION_TOKEN',
        message: 'Present your Base Session Token in the Authorization: Bearer <session_jwt> header.'
      },
      401
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<{
    justification?: string;
    ttl_seconds?: number;
    requested_roles?: string[];
    roles?: string[];
    permanent?: boolean;
    sessionId?: string;
    mode?: 'sandbox' | 'entra-external-id';
  }>(context.request, { allowEmpty: true });
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, message: parsedBody.message }, parsedBody.status);
  }
  const body = parsedBody.body;

  // 2. Signature verification
  const verified = await verifyWorkforceJourneyJwt(
    token,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );
  if (!verified.valid || !verified.decoded) {
    if (verified.expired) {
      return jsonResponse(
        {
          error: 'SESSION_EXPIRED',
          message: 'Session token has expired. Re-provision a fresh base session.'
        },
        401
      );
    }
    return jsonResponse(
      {
        error: 'INVALID_SESSION_TOKEN',
        message: verified.error || 'Session token signature verification failed.'
      },
      401
    );
  }

  const claims = verified.decoded.payload;
  const nowSec = Math.floor(Date.now() / 1000);

  // 3. Expiry check
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
    return jsonResponse(
      {
        error: 'SESSION_EXPIRED',
        message: 'Session token has expired. Re-provision a fresh base session.'
      },
      401
    );
  }

  // 4. Token type check
  if (claims.token_type !== 'session') {
    return jsonResponse(
      {
        error: 'INVALID_TOKEN_TYPE',
        message: 'Expected a Base Session Token (token_type: session).'
      },
      403
    );
  }

  // 5. Session binding check
  const rawSid = context.request.headers.get('X-Session-Id') || body.sessionId;
  const sessionId = sanitizeSessionId(rawSid || claims.sid);
  if (claims.sid && claims.sid !== sessionId) {
    return jsonResponse(
      {
        error: 'SESSION_MISMATCH',
        message: 'Session token does not belong to this visitor session.'
      },
      403
    );
  }

  // 6. CAEP revocation check
  const idp = createIdpAdapter(context.env, body.mode);
  const [jtiRevoked, dirRecord] = await Promise.all([
    idp.isJtiRevoked(sessionId, claims.jti),
    idp.getDirectoryRecord(sessionId)
  ]);

  if (jtiRevoked || dirRecord?.status === 'REVOKED') {
    return jsonResponse(
      {
        error: 'TOKEN_REVOKED',
        code: 'CAEP_SESSION_REVOKED',
        message: 'Session token has been revoked via Universal Logout (CAEP).'
      },
      401
    );
  }

  // 7. Server-side Separation of Duties (SOD-FIN-001)
  const existingRoles = Array.isArray(claims.roles) ? claims.roles : [];
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
    return jsonResponse(
      {
        error: 'INVALID_ROLES',
        invalid_roles: invalid,
        message: `Unsupported role(s): ${invalid.join(', ')}. Allowed roles: Viewer, Payment Creator, Audit Approver.`
      },
      400
    );
  }

  const requestedRoles =
    validatedRequested.length > 0 ? Array.from(new Set(validatedRequested)) : [...existingRoles];

  const effectiveRoles = Array.from(new Set([...existingRoles, ...requestedRoles]));
  if (effectiveRoles.includes('Payment Creator') && effectiveRoles.includes('Audit Approver')) {
    return jsonResponse(
      {
        error: 'SOD_CONFLICT',
        rule_id: 'SOD-FIN-001',
        message:
          'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
        conflicting_roles: ['Payment Creator', 'Audit Approver'],
        existing_roles: existingRoles,
        requested_roles: requestedRoles
      },
      403
    );
  }

  // 8. Server-side Zero Standing Privileges (ZSP) TTL enforcement
  if (body.permanent === true) {
    return jsonResponse(
      {
        error: 'ZSP_MAX_TTL_EXCEEDED',
        policy: 'IAM-ZSP-MAX-15M',
        max_ttl_seconds: MAX_JIT_TTL_SECONDS,
        requested_ttl_seconds:
          typeof body.ttl_seconds === 'number' && Number.isFinite(body.ttl_seconds)
            ? body.ttl_seconds
            : null,
        message:
          'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
      },
      400
    );
  }

  if (body.ttl_seconds !== undefined) {
    if (typeof body.ttl_seconds !== 'number' || !Number.isFinite(body.ttl_seconds)) {
      return jsonResponse(
        {
          error: 'INVALID_TTL',
          message: 'ttl_seconds must be between 60 and 900 seconds.'
        },
        400
      );
    }
    if (body.ttl_seconds > MAX_JIT_TTL_SECONDS) {
      return jsonResponse(
        {
          error: 'ZSP_MAX_TTL_EXCEEDED',
          policy: 'IAM-ZSP-MAX-15M',
          max_ttl_seconds: MAX_JIT_TTL_SECONDS,
          requested_ttl_seconds: body.ttl_seconds,
          message:
            'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
        },
        400
      );
    }
    if (body.ttl_seconds < MIN_JIT_TTL_SECONDS) {
      return jsonResponse(
        {
          error: 'INVALID_TTL',
          message: 'ttl_seconds must be between 60 and 900 seconds.'
        },
        400
      );
    }
  }

  const ttlSeconds =
    typeof body.ttl_seconds === 'number' ? Math.floor(body.ttl_seconds) : MAX_JIT_TTL_SECONDS;

  // 9. Persist PENDING request record in STATE_KV (1h TTL)
  const requestId = `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const nowIso = new Date().toISOString();
  const justification =
    typeof body.justification === 'string' && body.justification.trim()
      ? body.justification.trim()
      : 'Q4 Ledger Close — Export & reconcile treasury batch (INC-4821)';

  const record: JitRequestRecord = {
    request_id: requestId,
    session_id: sessionId,
    status: 'PENDING',
    requester: {
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      department: claims.department,
      base_roles: existingRoles,
      session_jti: claims.jti,
      entra_oid: dirRecord?.entra_oid
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
    idp_mode: idp.mode,
    created_at: nowIso
  };

  const storage = await saveJitRequestRecord(context.env, sessionId, record);

  return jsonResponse(
    {
      status: 'PENDING',
      request_id: requestId,
      sod_status: 'PASS',
      rule_id: 'SOD-FIN-001',
      ttl_seconds: ttlSeconds,
      kv_ttl_seconds: JIT_REQUEST_TTL_SECONDS,
      storage,
      idp_mode: idp.mode,
      request: record
    },
    201
  );
}
