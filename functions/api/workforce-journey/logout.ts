import { createIdpAdapter, type WorkforceJourneyEnv } from '../lib/idpAdapter';
import {
  extractBearerToken,
  parseJsonBodyWithLimit,
  sanitizeSessionId,
  verifyWorkforceJourneyJwt
} from '../lib/workforceJourneyCrypto';

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {})
    }
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  const bearer = extractBearerToken(context.request);
  if (!bearer) {
    return jsonResponse(
      {
        error: 'MISSING_SESSION_TOKEN',
        message: 'Authorization: Bearer <jwt> header is required to trigger Universal Logout.'
      },
      401
    );
  }

  const parsedBody = await parseJsonBodyWithLimit<{
    sessionId?: string;
    session_jwt?: string;
    jit_jwt?: string;
    reason?: string;
    mode?: 'sandbox' | 'entra-external-id';
  }>(context.request, { allowEmpty: true });
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, message: parsedBody.message }, parsedBody.status);
  }
  const body = parsedBody.body;

  const bearerVerified = await verifyWorkforceJourneyJwt(
    bearer,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );
  if (!bearerVerified.valid || !bearerVerified.decoded) {
    return jsonResponse(
      {
        error: 'INVALID_SESSION_TOKEN',
        message: bearerVerified.error || 'Bearer token verification failed.'
      },
      401
    );
  }

  const bearerClaims = bearerVerified.decoded.payload;
  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId || bearerClaims.sid
  );
  if (bearerClaims.sid && bearerClaims.sid !== sessionId) {
    return jsonResponse(
      {
        error: 'SESSION_MISMATCH',
        message: 'Session token does not belong to this visitor session.'
      },
      403
    );
  }

  const jtiSet = new Set<string>([bearerClaims.jti]);
  if (bearerClaims.elevated_from_jti) jtiSet.add(bearerClaims.elevated_from_jti);
  const subjectEmail = bearerClaims.email || 'alex.chen@acme-corp.io';

  const extraTokens = [body.session_jwt, body.jit_jwt].filter(
    (t): t is string => Boolean(t && t.trim())
  );
  for (const tok of extraTokens) {
    const verified = await verifyWorkforceJourneyJwt(
      tok,
      context.env.LAB1_JWT_SECRET,
      context.env.ENVIRONMENT
    );
    if (!verified.valid || !verified.decoded) {
      return jsonResponse(
        {
          error: 'INVALID_SESSION_TOKEN',
          message: verified.error || 'Body token verification failed.'
        },
        401
      );
    }
    const p = verified.decoded.payload;
    if (p.sid && p.sid !== sessionId) {
      return jsonResponse(
        {
          error: 'SESSION_MISMATCH',
          message: 'Body token does not belong to this visitor session.'
        },
        403
      );
    }
    jtiSet.add(p.jti);
    if (p.elevated_from_jti) jtiSet.add(p.elevated_from_jti);
  }

  const idp = createIdpAdapter(context.env, body.mode);
  const reason = body.reason || 'Universal Logout triggered by operator / CAEP signal';
  const revokeResult = await idp.revokeSessions({
    sessionId,
    jtiList: Array.from(jtiSet),
    reason
  });

  const scimRecord = await idp.getDirectoryRecord(sessionId);

  const caepEvent = {
    iss: idp.mode === 'entra-external-id' ? 'https://ciam.0trust.dev' : 'https://iam.0trust.dev',
    jti: `caep_${crypto.randomUUID().slice(0, 12)}`,
    iat: Math.floor(Date.now() / 1000),
    events: {
      'https://schemas.openid.net/secevent/caep/event-type/session-revoked': {
        subject: {
          format: 'email',
          email: scimRecord?.userName || subjectEmail
        },
        event_timestamp: Math.floor(Date.now() / 1000),
        initiating_entity: 'user',
        reason_admin: { en: reason }
      }
    }
  };

  const isHttps = context.request.url.startsWith('https://');
  const clearCookie = `lab1_entra_ticket=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`;

  return jsonResponse(
    {
      status: 'UNIVERSAL_LOGOUT_COMPLETE',
      session_id: sessionId,
      revoked_jtis: revokeResult.revoked_jtis,
      caep_event: caepEvent,
      scim_record: scimRecord,
      idp_mode: idp.mode,
      storage: revokeResult.storage,
      external_sync: revokeResult.external_sync,
      graph_request_id: revokeResult.graph_request_id
    },
    200,
    { 'Set-Cookie': clearCookie }
  );
}
