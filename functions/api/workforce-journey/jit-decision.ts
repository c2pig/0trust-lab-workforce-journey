import {
  createIdpAdapter,
  getJitRequestRecord,
  saveJitRequestRecord,
  type JitRequestRecord,
  type WorkforceJourneyEnv
} from '../lib/idpAdapter';
import {
  extractBearerToken,
  parseJsonBodyWithLimit,
  sanitizeSessionId,
  signWorkforceJourneyJwt,
  verifyWorkforceJourneyJwt,
  type WorkforceJourneyJwtPayload
} from '../lib/workforceJourneyCrypto';

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
  // 0. Require Approver Bearer JWT
  const approverToken = extractBearerToken(context.request);
  if (!approverToken) {
    return jsonResponse(
      {
        error: 'MISSING_APPROVER_TOKEN',
        message: 'Authorization: Bearer <approver_jwt> header is required.'
      },
      401
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<{
    request_id?: string;
    decision?: string;
    approver?: {
      id?: string;
      name?: string;
      email?: string;
    };
    reason?: string;
    sessionId?: string;
    mode?: 'sandbox' | 'entra-external-id';
  }>(context.request, { allowEmpty: false });
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, message: parsedBody.message }, parsedBody.status);
  }
  const body = parsedBody.body;

  const verifiedApprover = await verifyWorkforceJourneyJwt(
    approverToken,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );
  if (!verifiedApprover.valid || !verifiedApprover.decoded) {
    return jsonResponse(
      {
        error: verifiedApprover.expired ? 'APPROVER_TOKEN_EXPIRED' : 'INVALID_APPROVER_TOKEN',
        message: verifiedApprover.error || 'Approver token verification failed.'
      },
      401
    );
  }

  const approverClaims = verifiedApprover.decoded.payload;
  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId
  );
  if (approverClaims.sid && approverClaims.sid !== sessionId) {
    return jsonResponse(
      {
        error: 'SESSION_MISMATCH',
        message: 'Approver token does not belong to this visitor session.'
      },
      403
    );
  }

  const approverRoles = Array.isArray(approverClaims.roles) ? approverClaims.roles : [];
  if (!approverRoles.includes('Audit Approver')) {
    return jsonResponse(
      {
        error: 'APPROVER_ROLE_REQUIRED',
        message: 'Approver token must include the "Audit Approver" role.'
      },
      403
    );
  }

  // 1. Validate input fields
  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
  if (!requestId) {
    return jsonResponse(
      {
        error: 'MISSING_REQUEST_ID',
        message: 'request_id is required.'
      },
      400
    );
  }

  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'deny' && decision !== 'grant_permanent') {
    return jsonResponse(
      {
        error: 'INVALID_DECISION',
        message: 'decision must be one of: approve, deny, grant_permanent.'
      },
      400
    );
  }

  // 2. Load PENDING request from STATE_KV
  const record = await getJitRequestRecord(context.env, sessionId, requestId);
  if (!record) {
    return jsonResponse(
      {
        error: 'REQUEST_NOT_FOUND',
        request_id: requestId,
        message: `JIT request ${requestId} was not found or has expired.`
      },
      404
    );
  }

  if (record.status !== 'PENDING') {
    return jsonResponse(
      {
        error: 'REQUEST_ALREADY_DECIDED',
        status: record.status,
        request_id: requestId,
        message: `JIT request ${requestId} has already been decided (${record.status}).`
      },
      409
    );
  }

  // 3. Block grant_permanent (ZSP Policy Gate) WITHOUT mutating PENDING state
  if (decision === 'grant_permanent') {
    return jsonResponse(
      {
        error: 'ZSP_POLICY_VIOLATION',
        policy: 'IAM-ZSP-001',
        request_id: record.request_id,
        message:
          'Zero Standing Privileges Violation: Granting permanent admin access is prohibited. Only time-bound (<= 15m) JIT elevation is permitted.'
      },
      403
    );
  }

  // 4. Check requester & approver CAEP revocation
  const idp = createIdpAdapter(context.env, body.mode);
  const [jtiRevoked, approverJtiRevoked, dirRecord] = await Promise.all([
    idp.isJtiRevoked(sessionId, record.requester.session_jti),
    idp.isJtiRevoked(sessionId, approverClaims.jti),
    idp.getDirectoryRecord(sessionId)
  ]);

  if (jtiRevoked || approverJtiRevoked || dirRecord?.status === 'REVOKED') {
    return jsonResponse(
      {
        error: 'TOKEN_REVOKED',
        code: 'CAEP_SESSION_REVOKED',
        request_id: record.request_id,
        message: 'Requester session has been revoked via Universal Logout (CAEP).'
      },
      401
    );
  }

  // 5. Self-approval guard using verified JWT claims.email
  const approverEmail = (approverClaims.email || '').trim();
  const approverName = (approverClaims.name || 'Audit Approver').trim();
  if (!approverEmail || approverEmail.toLowerCase() === record.requester.email.toLowerCase()) {
    return jsonResponse(
      {
        error: 'SELF_APPROVAL_FORBIDDEN',
        request_id: record.request_id,
        message: 'Requester cannot approve their own JIT elevation request.'
      },
      403
    );
  }

  // 6. Defense-in-depth SoD & TTL re-check
  const effectiveRoles = Array.from(
    new Set([...(record.requester.base_roles || []), ...(record.requested_roles || [])])
  );
  if (effectiveRoles.includes('Payment Creator') && effectiveRoles.includes('Audit Approver')) {
    return jsonResponse(
      {
        error: 'SOD_CONFLICT',
        rule_id: 'SOD-FIN-001',
        request_id: record.request_id,
        message:
          'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
        conflicting_roles: ['Payment Creator', 'Audit Approver']
      },
      403
    );
  }

  if (
    !Number.isFinite(record.ttl_seconds) ||
    record.ttl_seconds > MAX_JIT_TTL_SECONDS ||
    record.ttl_seconds < MIN_JIT_TTL_SECONDS
  ) {
    return jsonResponse(
      {
        error: 'ZSP_MAX_TTL_EXCEEDED',
        policy: 'IAM-ZSP-MAX-15M',
        max_ttl_seconds: MAX_JIT_TTL_SECONDS,
        requested_ttl_seconds: record.ttl_seconds,
        message:
          'Zero Standing Privileges Violation: Maximum JIT elevation duration is 900 seconds (15 minutes).'
      },
      400
    );
  }

  const nowIso = new Date().toISOString();

  // 7. Branch decision === 'deny'
  if (decision === 'deny') {
    const reason = body.reason?.trim() || 'Denied by approver';
    const updatedRecord: JitRequestRecord = {
      ...record,
      status: 'DENIED',
      decided_at: nowIso,
      decided_by: approverEmail,
      decision_reason: reason
    };
    const storage = await saveJitRequestRecord(context.env, sessionId, updatedRecord);
    return jsonResponse({
      status: 'JIT_DENIED',
      request_id: updatedRecord.request_id,
      denied_by: approverEmail,
      denied_by_name: approverName,
      reason,
      storage,
      idp_mode: idp.mode,
      request: updatedRecord
    });
  }

  // 8. Branch decision === 'approve'
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(
    MIN_JIT_TTL_SECONDS,
    Math.min(MAX_JIT_TTL_SECONDS, Math.floor(record.ttl_seconds || MAX_JIT_TTL_SECONDS))
  );
  const jitJti = `jit_${crypto.randomUUID().slice(0, 12)}`;
  const reason = body.reason?.trim() || 'Approved by manager';

  const elevationResult = await idp.elevateJit({
    sessionId,
    jitJti,
    entraOid: record.requester.entra_oid || dirRecord?.entra_oid,
    justification: record.justification,
    ttlSeconds
  });

  const updatedRecord: JitRequestRecord = {
    ...record,
    status: 'APPROVED',
    decided_at: nowIso,
    decided_by: approverEmail,
    decision_reason: reason,
    jit_jti: jitJti
  };
  const storage = await saveJitRequestRecord(context.env, sessionId, updatedRecord);

  const jitPayload: WorkforceJourneyJwtPayload = {
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
  };

  const signedJit = await signWorkforceJourneyJwt(
    jitPayload,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );

  return jsonResponse({
    status: 'JIT_GRANTED',
    policy: 'IAM-JIT-15M',
    request_id: updatedRecord.request_id,
    approved_by: approverEmail,
    approved_by_name: approverName,
    justification: updatedRecord.justification,
    expires_in: ttlSeconds,
    jit_jwt: signedJit.token,
    decoded_claims: {
      header: signedJit.header,
      payload: signedJit.payload
    },
    scim_record: elevationResult.scim_record,
    idp_mode: idp.mode,
    storage,
    external_sync: elevationResult.external_sync,
    graph_request_id: elevationResult.graph_request_id,
    pam_api_status: elevationResult.pam_api_status,
    request: updatedRecord
  });
}
