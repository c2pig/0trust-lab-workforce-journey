import { isEntraExternalConfigured, type WorkforceJourneyEnv } from '../../lib/idpAdapter';
import { resolvePublicOrigin } from '../../../../server/origin';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function pkceS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export async function onRequestGet(context: {
  request: Request;
  env: WorkforceJourneyEnv;
}): Promise<Response> {
  const origin = resolvePublicOrigin(context.request);

  if (!isEntraExternalConfigured(context.env)) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=NOT_CONFIGURED`,
      302
    );
  }

  if (!context.env.STATE_KV) {
    return Response.redirect(
      `${origin}/workforce-journey?entra_error=STATE_KV_UNAVAILABLE`,
      302
    );
  }

  const state = randomBase64Url(16);
  const nonce = randomBase64Url(16);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await pkceS256Challenge(codeVerifier);
  const redirectUri = `${origin}/api/workforce-journey/entra/callback`;

  await context.env.STATE_KV.put(
    `lab1:pkce:${state}`,
    JSON.stringify({ code_verifier: codeVerifier, redirect_uri: redirectUri, nonce }),
    { expirationTtl: 600 }
  );

  const baseAuthority = (
    context.env.ENTRA_EXT_AUTHORITY ||
    `https://login.microsoftonline.com/${encodeURIComponent(context.env.ENTRA_EXT_TENANT_ID!)}/v2.0`
  ).replace(/\/v2\.0\/?$/, '');

  const authUrl = new URL(`${baseAuthority}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', context.env.ENTRA_EXT_CLIENT_ID!);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return Response.redirect(authUrl.toString(), 302);
}
