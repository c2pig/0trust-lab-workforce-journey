import { isEntraExternalConfigured, type WorkforceJourneyEnv } from '../lib/idpAdapter';

export async function onRequestGet(context: { env: WorkforceJourneyEnv }): Promise<Response> {
  return new Response(
    JSON.stringify({
      sandbox_available: true,
      entra_external_id_configured: isEntraExternalConfigured(context.env),
      pam_api_configured: Boolean(context.env.PAM_API_URL),
      privileged_group_configured: Boolean(context.env.PRIVILEGED_GROUP_ID)
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    }
  );
}
