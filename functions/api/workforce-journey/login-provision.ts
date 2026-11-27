import { createIdpAdapter, type WorkforceJourneyEnv } from '../lib/idpAdapter';
import {
  getCookieValue,
  parseJsonBodyWithLimit,
  sanitizeSessionId,
  signWorkforceJourneyJwt,
  type WorkforceJourneyJwtPayload
} from '../lib/workforceJourneyCrypto';

interface PersonaConfig {
  id: string;
  name: string;
  email: string;
  department: string;
}

const PERSONAS: Record<string, PersonaConfig> = {
  'alex-chen': {
    id: 'alex-chen',
    name: 'Alex Chen',
    email: 'alex.chen@acme-corp.io',
    department: 'Finance Operations'
  },
  'sarah-lin': {
    id: 'sarah-lin',
    name: 'Sarah Lin',
    email: 'sarah.lin@acme-corp.io',
    department: 'Payments Engineering'
  },
  'jordan-patel': {
    id: 'jordan-patel',
    name: 'Jordan Patel',
    email: 'jordan.patel@acme-corp.io',
    department: 'Security Audit'
  },
  'maya-lin': {
    id: 'maya-lin',
    name: 'Maya Lin',
    email: 'maya.lin@acme-corp.io',
    department: 'Finance Operations'
  },
  'marcus-chen': {
    id: 'marcus-chen',
    name: 'Marcus Chen',
    email: 'marcus.chen@acme-corp.io',
    department: 'Finance Management'
  },
  'priya-nair': {
    id: 'priya-nair',
    name: 'Priya Nair',
    email: 'priya.nair@acme-corp.io',
    department: 'SecOps & IAM'
  }
};

const VALID_ROLES = new Set(['Viewer', 'Payment Creator', 'Audit Approver']);

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
  const parsedBody = await parseJsonBodyWithLimit<{
    personaId?: string;
    roles?: string[];
    sessionId?: string;
    mode?: 'sandbox' | 'entra-external-id';
    entra_ticket?: string;
  }>(context.request, { allowEmpty: false });
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.error, message: parsedBody.message }, parsedBody.status);
  }
  const body = parsedBody.body;

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId
  );
  let persona = PERSONAS[body.personaId || 'alex-chen'] || PERSONAS['alex-chen'];
  let entraOid: string | undefined;

  if (body.mode === 'entra-external-id') {
    const cookieTicket = getCookieValue(context.request, 'lab1_entra_ticket');
    const ticket = cookieTicket || (typeof body.entra_ticket === 'string' ? body.entra_ticket.trim() : '');
    if (!ticket) {
      return jsonResponse(
        {
          error: 'ENTRA_OIDC_REQUIRED',
          message: 'Sign in with Email OTP (Entra External ID) first before provisioning.'
        },
        401
      );
    }
    if (!context.env.STATE_KV && context.env.ENVIRONMENT === 'production') {
      return jsonResponse(
        {
          error: 'ENTRA_OIDC_REQUIRED',
          message: 'STATE_KV is required for Entra External ID ticket verification.'
        },
        401
      );
    }
    if (context.env.STATE_KV) {
      const rawTicket = await context.env.STATE_KV.get(`lab1:entra-oidc:${ticket}`);
      if (!rawTicket) {
        return jsonResponse(
          {
            error: 'ENTRA_TICKET_EXPIRED',
            message: 'Entra External ID session ticket expired or invalid. Sign in again.'
          },
          401
        );
      }
      const ticketData = JSON.parse(rawTicket) as { oid: string; email: string; name: string };
      entraOid = ticketData.oid;
      persona = {
        id: ticketData.oid,
        name: ticketData.name,
        email: ticketData.email,
        department: 'External Visitor (Entra CIAM)'
      };
    }
  }

  const requestedRoles = Array.isArray(body.roles)
    ? body.roles.filter((r) => VALID_ROLES.has(r))
    : [];

  if (requestedRoles.length === 0) {
    return jsonResponse(
      {
        error: 'ROLES_REQUIRED',
        message: 'Select at least one role (Viewer, Payment Creator, or Audit Approver).'
      },
      400
    );
  }

  // 1. Separation of Duties (SoD) Rule Matrix
  const hasCreator = requestedRoles.includes('Payment Creator');
  const hasApprover = requestedRoles.includes('Audit Approver');
  if (hasCreator && hasApprover) {
    return jsonResponse(
      {
        error: 'SOD_CONFLICT',
        rule_id: 'SOD-FIN-001',
        message:
          'Separation of Duties Violation: "Payment Creator" cannot simultaneously hold "Audit Approver".',
        conflicting_roles: ['Payment Creator', 'Audit Approver'],
        persona: persona.name,
        requested_roles: requestedRoles
      },
      403
    );
  }

  // 2. Directory Write via Pluggable IdpAdapter
  const idp = createIdpAdapter(context.env, body.mode);
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionJti = `sess_${crypto.randomUUID().slice(0, 12)}`;

  const provisionResult = await idp.provisionUser({
    sessionId,
    personaId: persona.id,
    email: persona.email,
    displayName: persona.name,
    department: persona.department,
    roles: requestedRoles,
    sessionJti,
    entraOid
  });

  // 3. WebCrypto Session JWT Minting (HMAC-SHA256, exp: +1h)
  const payload: WorkforceJourneyJwtPayload = {
    iss: idp.mode === 'entra-external-id' ? 'https://ciam.0trust.dev' : 'https://iam.0trust.dev',
    sub: persona.id,
    email: persona.email,
    name: persona.name,
    department: persona.department,
    roles: requestedRoles,
    scope: 'session:base',
    token_type: 'session',
    jti: sessionJti,
    sid: sessionId,
    iat: nowSec,
    exp: nowSec + 3600
  };

  const signed = await signWorkforceJourneyJwt(
    payload,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );

  // Mint Seat 2 Approver JWT (Marcus Chen, Audit Approver) without overwriting requester SCIM record
  const approverPersona = PERSONAS['marcus-chen'];
  const approverPayload: WorkforceJourneyJwtPayload = {
    iss: idp.mode === 'entra-external-id' ? 'https://ciam.0trust.dev' : 'https://iam.0trust.dev',
    sub: approverPersona.id,
    email: approverPersona.email,
    name: approverPersona.name,
    department: approverPersona.department,
    roles: ['Audit Approver'],
    scope: 'pam:approve',
    token_type: 'session',
    jti: `apprv_${crypto.randomUUID().slice(0, 12)}`,
    sid: sessionId,
    iat: nowSec,
    exp: nowSec + 3600
  };
  const approverSigned = await signWorkforceJourneyJwt(
    approverPayload,
    context.env.LAB1_JWT_SECRET,
    context.env.ENVIRONMENT
  );

  return jsonResponse({
    status: 'PROVISIONED',
    persona,
    roles: requestedRoles,
    session_jwt: signed.token,
    approver_jwt: approverSigned.token,
    decoded_claims: {
      header: signed.header,
      payload: signed.payload
    },
    scim_record: provisionResult.scim_record,
    idp_mode: idp.mode,
    storage: provisionResult.storage,
    external_sync: provisionResult.external_sync,
    graph_request_id: provisionResult.graph_request_id
  });
}
