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

type TargetEndpoint = 'ledger_read' | 'payment_create' | 'payment_approve';

const ENDPOINT_RULES: Record<
  TargetEndpoint,
  { resource: string; requiredRoles: string[]; requiredLabel: string }
> = {
  ledger_read: {
    resource: 'GET /api/v1/ledger/read',
    requiredRoles: ['Viewer', 'Payment Creator', 'Audit Approver'],
    requiredLabel: 'Viewer'
  },
  payment_create: {
    resource: 'POST /api/v1/payments/create',
    requiredRoles: ['Payment Creator'],
    requiredLabel: 'Payment Creator'
  },
  payment_approve: {
    resource: 'POST /api/v1/payments/approve',
    requiredRoles: ['Audit Approver'],
    requiredLabel: 'Audit Approver'
  }
};

export async function onRequestPost(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  const token = extractBearerToken(context.request);
  if (!token) {
    return jsonResponse(
      {
        error: 'MISSING_BEARER_TOKEN',
        message: 'Authorization: Bearer <jit_jwt> header is required.'
      },
      401
    );
  }

  let body: {
    action?: string;
    target_endpoint?: TargetEndpoint;
    simulate_expired?: boolean;
    sessionId?: string;
  } = {};
  try {
    body = (await context.request.json()) as {
      action?: string;
      target_endpoint?: TargetEndpoint;
      simulate_expired?: boolean;
      sessionId?: string;
    };
  } catch {
    // Optional JSON body
  }

  const endpointKey: TargetEndpoint =
    body.target_endpoint && body.target_endpoint in ENDPOINT_RULES
      ? body.target_endpoint
      : 'ledger_read';
  const rule = ENDPOINT_RULES[endpointKey];

  // 1. Validate JWT signature
  const verified = await verifyWorkforceJourneyJwt(token, context.env.LAB1_JWT_SECRET);
  if (!verified.valid || !verified.decoded) {
    return jsonResponse(
      {
        error: 'INVALID_TOKEN',
        resource: rule.resource,
        message: verified.error || 'Token signature verification failed.'
      },
      401
    );
  }

  const claims = verified.decoded.payload;
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId || claims.sid
  );
  if (claims.sid && claims.sid !== sessionId) {
    return jsonResponse(
      {
        error: 'SESSION_MISMATCH',
        resource: rule.resource,
        message: 'Token does not belong to this visitor session.'
      },
      403
    );
  }

  // 2. Check KV Revocation List (CAEP session-revoked)
  const idp = createIdpAdapter(context.env);
  const tokenSessionId = claims.sid ? sanitizeSessionId(claims.sid) : sessionId;
  const sessionIdsToCheck =
    tokenSessionId !== sessionId ? [sessionId, tokenSessionId] : [sessionId];

  const [revokedResults, dirRecords] = await Promise.all([
    Promise.all(
      sessionIdsToCheck.flatMap((sid) => [
        idp.isJtiRevoked(sid, claims.jti),
        claims.elevated_from_jti
          ? idp.isJtiRevoked(sid, claims.elevated_from_jti)
          : Promise.resolve(false)
      ])
    ),
    Promise.all(sessionIdsToCheck.map((sid) => idp.getDirectoryRecord(sid)))
  ]);

  if (revokedResults.some(Boolean) || dirRecords.some((rec) => rec?.status === 'REVOKED')) {
    return jsonResponse(
      {
        error: 'TOKEN_REVOKED',
        code: 'CAEP_SESSION_REVOKED',
        resource: rule.resource,
        jti: claims.jti,
        message:
          'HTTP 401 Revoked: Session was terminated by Universal Logout (OpenID CAEP).'
      },
      401
    );
  }

  // 3. Check Expiry (including Fast-Forward 15:00 demo simulation)
  if (body.simulate_expired || claims.exp <= nowSec) {
    return jsonResponse(
      {
        error: 'TOKEN_EXPIRED',
        resource: rule.resource,
        jti: claims.jti,
        message:
          'HTTP 401 Expired: 15-minute JIT elevation window has elapsed.'
      },
      401
    );
  }

  // 4. Enforce Elevated Scope (Zero Standing Privilege)
  if (claims.scope !== 'admin:temp' || claims.token_type !== 'jit_elevated') {
    return jsonResponse(
      {
        error: 'INSUFFICIENT_SCOPE',
        resource: rule.resource,
        message:
          'HTTP 403 Standing Privilege Denied: Request a 15m JIT Token in Step 2.'
      },
      403
    );
  }

  // 5. Enforce Endpoint RBAC Matrix against JWT roles claim
  const tokenRoles = Array.isArray(claims.roles) ? claims.roles : [];
  const hasRequiredRole = tokenRoles.some((r) => rule.requiredRoles.includes(r));
  if (!hasRequiredRole) {
    return jsonResponse(
      {
        error: 'ROLE_DENIED',
        resource: rule.resource,
        required_role: rule.requiredLabel,
        token_roles: tokenRoles,
        message: `HTTP 403 Forbidden: Token lacks required role "${rule.requiredLabel}".`
      },
      403
    );
  }

  return jsonResponse({
    status: 'AUTHORIZED',
    http_status: 200,
    resource: rule.resource,
    required_role: rule.requiredLabel,
    action: body.action || endpointKey.toUpperCase(),
    actor: claims.email,
    roles: tokenRoles,
    scope: claims.scope,
    jti: claims.jti,
    remaining_seconds: Math.max(0, claims.exp - nowSec),
    verified_checks: [
      'WebCrypto HMAC-SHA256 signature valid',
      'STATE_KV revocation check: NOT REVOKED',
      'Token exp > now (within 15m JIT window)',
      'Scope == admin:temp (JIT elevated)',
      `RBAC role check: "${rule.requiredLabel}" present`
    ]
  });
}
