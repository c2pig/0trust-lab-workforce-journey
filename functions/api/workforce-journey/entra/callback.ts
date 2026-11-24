import { isEntraExternalConfigured, type WorkforceJourneyEnv } from '../../lib/idpAdapter';
import { resolvePublicOrigin } from '../../../../server/origin';

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded =
      parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function onRequestGet(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const origin = resolvePublicOrigin(context.request);

  const error = url.searchParams.get('error');
  if (error) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=${encodeURIComponent(error)}`,
      302
    );
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !isEntraExternalConfigured(context.env)) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=INVALID_CALLBACK`,
      302
    );
  }

  let codeVerifier = '';
  let redirectUri = `${origin}/api/workforce-journey/entra/callback`;
  if (context.env.STATE_KV) {
    const raw = await context.env.STATE_KV.get(`lab1:pkce:${state}`);
    if (!raw) {
      return Response.redirect(
        `${origin}/workforce-journey?entra_error=PKCE_STATE_EXPIRED`,
        302
      );
    }
    const parsed = JSON.parse(raw) as { code_verifier: string; redirect_uri: string };
    codeVerifier = parsed.code_verifier;
    redirectUri = parsed.redirect_uri;
    await context.env.STATE_KV.delete(`lab1:pkce:${state}`);
  }

  const baseAuthority = (
    context.env.ENTRA_EXT_AUTHORITY ||
    `https://login.microsoftonline.com/${encodeURIComponent(context.env.ENTRA_EXT_TENANT_ID!)}/v2.0`
  ).replace(/\/v2\.0\/?$/, '');

  const tokenParams = new URLSearchParams({
    client_id: context.env.ENTRA_EXT_CLIENT_ID!,
    client_secret: context.env.ENTRA_EXT_CLIENT_SECRET!,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const tokenRes = await fetch(`${baseAuthority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString()
  });

  if (!tokenRes.ok) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=TOKEN_EXCHANGE_FAILED`,
      302
    );
  }

  const tokenData = (await tokenRes.json()) as { id_token?: string };
  const claims = tokenData.id_token ? decodeJwtPayload(tokenData.id_token) : null;
  const oid = String(claims?.oid || claims?.sub || '');
  const email = String(
    claims?.email || claims?.preferred_username || 'external.visitor@entra-ciam'
  );
  const name = String(claims?.name || email.split('@')[0]);

  if (!oid) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=MISSING_OID_CLAIM`,
      302
    );
  }

  const ticketBytes = new Uint8Array(16);
  crypto.getRandomValues(ticketBytes);
  const ticket = Array.from(ticketBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  if (context.env.STATE_KV) {
    await context.env.STATE_KV.put(
      `lab1:entra-oidc:${ticket}`,
      JSON.stringify({ oid, email, name, verified_at: new Date().toISOString() }),
      { expirationTtl: 3600 }
    );
  }

  const returnParams = new URLSearchParams({
    entra_ticket: ticket,
    oid,
    email
  });
  return Response.redirect(
    `${origin}/workforce-journey?${returnParams.toString()}`,
    302
  );
}
