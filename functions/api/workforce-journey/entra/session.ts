import type { WorkforceJourneyEnv } from '../../lib/idpAdapter';
import { getCookieValue } from '../../lib/workforceJourneyCrypto';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  const ticket = getCookieValue(context.request, 'lab1_entra_ticket');
  if (!ticket || !context.env.STATE_KV) {
    return jsonResponse(
      {
        authenticated: false,
        error: 'ENTRA_OIDC_REQUIRED',
        message: 'Entra External ID session cookie is missing or expired.'
      },
      401
    );
  }

  const raw = await context.env.STATE_KV.get(`lab1:entra-oidc:${ticket}`);
  if (!raw) {
    return jsonResponse(
      {
        authenticated: false,
        error: 'ENTRA_TICKET_EXPIRED',
        message: 'Entra External ID session ticket expired or invalid. Sign in again.'
      },
      401
    );
  }

  const parsed = JSON.parse(raw) as { oid: string; email: string; name: string };
  return jsonResponse({
    authenticated: true,
    oid: parsed.oid,
    email: parsed.email,
    name: parsed.name
  });
}
