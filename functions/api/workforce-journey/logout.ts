import { createIdpAdapter, type WorkforceJourneyEnv } from '../lib/idpAdapter';
import {
  extractBearerToken,
  sanitizeSessionId,
  verifyWorkforceJourneyJwt
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
  let body: {
    sessionId?: string;
    session_jwt?: string;
    jit_jwt?: string;
    reason?: string;
    mode?: 'sandbox' | 'entra-external-id';
  } = {};
  try {
    body = (await context.request.json()) as {
      sessionId?: string;
      session_jwt?: string;
      jit_jwt?: string;
      reason?: string;
      mode?: 'sandbox' | 'entra-external-id';
    };
  } catch {
    // Allow empty JSON body
  }

  const bearer = extractBearerToken(context.request);
  const candidateTokens = [bearer, body.session_jwt, body.jit_jwt].filter(
    (t): t is string => Boolean(t && t.trim())
  );

  const jtiSet = new Set<string>();
  let inferredSid: string | undefined;
  let subjectEmail = 'alex.chen@acme-corp.io';

  for (const tok of candidateTokens) {
    const verified = await verifyWorkforceJourneyJwt(tok, context.env.LAB1_JWT_SECRET);
    if (verified.valid && verified.decoded) {
      const p = verified.decoded.payload;
      jtiSet.add(p.jti);
      if (p.elevated_from_jti) jtiSet.add(p.elevated_from_jti);
      if (!inferredSid) inferredSid = p.sid;
      subjectEmail = p.email;
    }
  }

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId || inferredSid
  );

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

  return jsonResponse({
    status: 'UNIVERSAL_LOGOUT_COMPLETE',
    session_id: sessionId,
    revoked_jtis: revokeResult.revoked_jtis,
    caep_event: caepEvent,
    scim_record: scimRecord,
    idp_mode: idp.mode,
    storage: revokeResult.storage,
    external_sync: revokeResult.external_sync,
    graph_request_id: revokeResult.graph_request_id
  });
}
