import { createIdpAdapter, type WorkforceJourneyEnv } from '../lib/idpAdapter';
import {
  extractBearerToken,
  sanitizeSessionId,
  signWorkforceJourneyJwt,
  verifyWorkforceJourneyJwt,
  type WorkforceJourneyJwtPayload
} from '../lib/workforceJourneyCrypto';

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
  const token = extractBearerToken(context.request);
  if (!token) {
    return jsonResponse(
      {
        error: 'MISSING_SESSION_TOKEN',
        message: 'Present your Step 1 Session Token in the Authorization: Bearer <token> header.'
      },
      401
    );
  }

  let body: {
    justification?: string;
    ttl_seconds?: number;
    sessionId?: string;
    mode?: 'sandbox' | 'entra-external-id';
  } = {};
  try {
    body = (await context.request.json()) as {
      justification?: string;
      ttl_seconds?: number;
      sessionId?: string;
      mode?: 'sandbox' | 'entra-external-id';
    };
  } catch {
    // Allow empty JSON body
  }

  // 1. Verify Presented Session JWT
  const verified = await verifyWorkforceJourneyJwt(token, context.env.LAB1_JWT_SECRET);
  if (!verified.valid || !verified.decoded) {
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
  if (claims.exp <= nowSec) {
    return jsonResponse(
      {
        error: 'SESSION_EXPIRED',
        message: 'Session token has expired. Re-provision in Step 1.'
      },
      401
    );
  }

  if (claims.token_type !== 'session') {
    return jsonResponse(
      {
        error: 'INVALID_TOKEN_TYPE',
        message: 'Expected a Step 1 Session Token (token_type: session).'
      },
      403
    );
  }

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId || claims.sid
  );
  if (claims.sid && claims.sid !== sessionId) {
    return jsonResponse(
      {
        error: 'SESSION_MISMATCH',
        message: 'Session token does not belong to this visitor session.'
      },
      403
    );
  }

  const idp = createIdpAdapter(context.env, body.mode);
  const tokenSessionId = claims.sid ? sanitizeSessionId(claims.sid) : sessionId;
  const sessionIdsToCheck =
    tokenSessionId !== sessionId ? [sessionId, tokenSessionId] : [sessionId];

  const [revokedResults, dirRecords] = await Promise.all([
    Promise.all(sessionIdsToCheck.map((sid) => idp.isJtiRevoked(sid, claims.jti))),
    Promise.all(sessionIdsToCheck.map((sid) => idp.getDirectoryRecord(sid)))
  ]);

  if (revokedResults.some(Boolean) || dirRecords.some((rec) => rec?.status === 'REVOKED')) {
    return jsonResponse(
      {
        error: 'TOKEN_REVOKED',
        code: 'CAEP_SESSION_REVOKED',
        message: 'Session token has been revoked via Universal Logout (CAEP).'
      },
      401
    );
  }

  // 2. Enforce Time-Bound Elevation Policy (15m max = 900s)
  const requestedTtl = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : 900;
  const clampedTtl = Math.max(60, Math.min(900, Math.floor(requestedTtl)));
  const jitJti = `jit_${crypto.randomUUID().slice(0, 12)}`;
  const justification =
    body.justification || 'Emergency production payment audit & treasury configuration';

  const existingRecord = await idp.getDirectoryRecord(sessionId);
  const elevationResult = await idp.elevateJit({
    sessionId,
    jitJti,
    entraOid: existingRecord?.entra_oid,
    justification,
    ttlSeconds: clampedTtl
  });

  // 3. Mint Short-Lived JIT Token (scope: admin:temp, exp: +15m)
  const jitPayload: WorkforceJourneyJwtPayload = {
    iss: 'https://pam.0trust.dev',
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    department: claims.department,
    roles: claims.roles,
    scope: 'admin:temp',
    token_type: 'jit_elevated',
    jti: jitJti,
    sid: sessionId,
    elevated_from_jti: claims.jti,
    iat: nowSec,
    exp: nowSec + clampedTtl
  };

  const signedJit = await signWorkforceJourneyJwt(jitPayload, context.env.LAB1_JWT_SECRET);

  return jsonResponse({
    status: 'JIT_GRANTED',
    policy: 'IAM-JIT-15M',
    justification,
    expires_in: clampedTtl,
    jit_jwt: signedJit.token,
    decoded_claims: {
      header: signedJit.header,
      payload: signedJit.payload
    },
    scim_record: elevationResult.scim_record,
    idp_mode: idp.mode,
    external_sync: elevationResult.external_sync,
    graph_request_id: elevationResult.graph_request_id,
    pam_api_status: elevationResult.pam_api_status
  });
}
