export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkforceJourneyEnv {
  STATE_KV?: KVNamespace;
  ENVIRONMENT?: string;
  LAB1_JWT_SECRET?: string;
  OTLP_ENDPOINT?: string;
  OTLP_AUTH_HEADER?: string;
  // Entra External ID (CIAM) + Microsoft Graph + iam-demo pam-api
  ENTRA_EXT_TENANT_ID?: string;
  ENTRA_EXT_CLIENT_ID?: string;
  ENTRA_EXT_CLIENT_SECRET?: string;
  ENTRA_EXT_AUTHORITY?: string; // e.g. https://<subdomain>.ciamlogin.com/<tenantId>/v2.0
  PRIVILEGED_GROUP_ID?: string;
  PAM_API_URL?: string;
  PAM_API_TOKEN?: string;
}

export type WorkforceJourneyIdpMode = 'edge-webcrypto' | 'entra-external-id';

export interface ScimUserRecord {
  schemas: string[];
  id: string;
  userName: string;
  displayName: string;
  department: string;
  active: boolean;
  status: 'ACTIVE' | 'REVOKED';
  roles: string[];
  active_jtis: string[];
  provisioned_at: string;
  revoked_at?: string;
  idp_adapter: WorkforceJourneyIdpMode;
  entra_oid?: string;
  privileged_group_active?: boolean;
  graph_request_id?: string;
}

export interface ProvisionUserInput {
  sessionId: string;
  personaId: string;
  email: string;
  displayName: string;
  department: string;
  roles: string[];
  sessionJti: string;
  entraOid?: string;
}

export interface ElevateJitInput {
  sessionId: string;
  jitJti: string;
  entraOid?: string;
  justification: string;
  ttlSeconds: number;
}

export interface RevokeSessionsInput {
  sessionId: string;
  jtiList: string[];
  reason: string;
  entraOid?: string;
}

export interface IdpAdapter {
  readonly mode: WorkforceJourneyIdpMode;
  provisionUser(input: ProvisionUserInput): Promise<{
    scim_record: ScimUserRecord;
    storage: 'cloudflare-kv' | 'ephemeral-edge';
    external_sync: string;
    graph_request_id?: string;
  }>;
  elevateJit(input: ElevateJitInput): Promise<{
    scim_record: ScimUserRecord | null;
    external_sync: string;
    graph_request_id?: string;
    pam_api_status?: string;
  }>;
  isJtiRevoked(sessionId: string, jti: string): Promise<boolean>;
  revokeSessions(input: RevokeSessionsInput): Promise<{
    revoked_jtis: string[];
    external_sync: string;
    storage: 'cloudflare-kv' | 'ephemeral-edge';
    graph_request_id?: string;
  }>;
  getDirectoryRecord(sessionId: string): Promise<ScimUserRecord | null>;
}

const SESSION_TTL_SECONDS = 3600; // 1 hour per-visitor isolated state
export const JIT_REQUEST_TTL_SECONDS = 3600; // 1 hour per-visitor isolated state

export interface JitRequestRecord {
  request_id: string;
  session_id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  requester: {
    sub: string;
    email: string;
    name: string;
    department: string;
    base_roles: string[];
    session_jti: string;
    entra_oid?: string;
  };
  requested_roles: string[];
  requested_scope: 'admin:temp';
  justification: string;
  ttl_seconds: number;
  sod_check: {
    rule_id: 'SOD-FIN-001';
    status: 'PASS';
    checked_at: string;
  };
  idp_mode: WorkforceJourneyIdpMode;
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  decision_reason?: string;
  jit_jti?: string;
}

// Isolate-scoped ephemeral fallback stores when STATE_KV is not bound (e.g., local Wrangler without KV)
const ephemeralDirStore = new Map<string, { value: string; expiresAt: number }>();
const ephemeralRevokedStore = new Map<string, { value: string; expiresAt: number }>();
const ephemeralJitReqStore = new Map<string, { value: string; expiresAt: number }>();

function getEphemeral(store: Map<string, { value: string; expiresAt: number }>, key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function putEphemeral(
  store: Map<string, { value: string; expiresAt: number }>,
  key: string,
  value: string,
  ttlSeconds: number
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function dirKey(sessionId: string): string {
  return `lab1:dir:${sessionId}`;
}

export function revokedKey(sessionId: string, jti: string): string {
  return `lab1:revoked:${sessionId}:${jti}`;
}

export function jitRequestKey(sessionId: string, requestId: string): string {
  return `lab1:jit-req:${sessionId}:${requestId}`;
}

export async function saveJitRequestRecord(
  env: WorkforceJourneyEnv,
  sessionId: string,
  record: JitRequestRecord
): Promise<'cloudflare-kv' | 'ephemeral-edge'> {
  const key = jitRequestKey(sessionId, record.request_id);
  const serialized = JSON.stringify(record);
  if (env.STATE_KV) {
    await env.STATE_KV.put(key, serialized, { expirationTtl: JIT_REQUEST_TTL_SECONDS });
    return 'cloudflare-kv';
  }
  putEphemeral(ephemeralJitReqStore, key, serialized, JIT_REQUEST_TTL_SECONDS);
  return 'ephemeral-edge';
}

export async function getJitRequestRecord(
  env: WorkforceJourneyEnv,
  sessionId: string,
  requestId: string
): Promise<JitRequestRecord | null> {
  const key = jitRequestKey(sessionId, requestId);
  const raw = env.STATE_KV
    ? await env.STATE_KV.get(key)
    : getEphemeral(ephemeralJitReqStore, key);
  return raw ? (JSON.parse(raw) as JitRequestRecord) : null;
}

export function isEntraExternalConfigured(env: WorkforceJourneyEnv): boolean {
  return Boolean(
    env.ENTRA_EXT_TENANT_ID && env.ENTRA_EXT_CLIENT_ID && env.ENTRA_EXT_CLIENT_SECRET
  );
}

async function getGraphAppToken(env: WorkforceJourneyEnv): Promise<string | null> {
  if (!env.ENTRA_EXT_TENANT_ID || !env.ENTRA_EXT_CLIENT_ID || !env.ENTRA_EXT_CLIENT_SECRET) {
    return null;
  }
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(env.ENTRA_EXT_TENANT_ID)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.ENTRA_EXT_CLIENT_ID,
    client_secret: env.ENTRA_EXT_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token || null;
}

async function callGraph(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; requestId?: string; json?: Record<string, unknown> }> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const requestId = res.headers.get('request-id') || res.headers.get('x-ms-request-id') || undefined;
  let json: Record<string, unknown> | undefined;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // 204 No Content is common for $ref / revokeSignInSessions
  }
  return { ok: res.ok, status: res.status, requestId, json };
}

export function createIdpAdapter(
  env: WorkforceJourneyEnv,
  requestedMode?: 'sandbox' | 'entra-external-id'
): IdpAdapter {
  const useEntra = requestedMode === 'entra-external-id' && isEntraExternalConfigured(env);
  const mode: WorkforceJourneyIdpMode = useEntra ? 'entra-external-id' : 'edge-webcrypto';

  return {
    mode,

    async provisionUser(input: ProvisionUserInput) {
      const now = new Date().toISOString();
      let graphRequestId: string | undefined;
      let externalSync = 'Edge WebCrypto + Cloudflare STATE_KV ($0/mo default)';

      if (mode === 'entra-external-id' && input.entraOid) {
        const graphToken = await getGraphAppToken(env);
        if (graphToken) {
          const gRes = await callGraph(
            graphToken,
            'GET',
            `/users/${encodeURIComponent(input.entraOid)}?$select=id,displayName,mail,accountEnabled`
          );
          graphRequestId = gRes.requestId;
          externalSync = gRes.ok
            ? `Microsoft Graph GET /users/${input.entraOid} (HTTP ${gRes.status})`
            : `Microsoft Graph user lookup returned HTTP ${gRes.status}`;
        }
      }

      const scimRecord: ScimUserRecord = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: input.entraOid ? input.entraOid : `scim_${input.personaId}`,
        userName: input.email,
        displayName: input.displayName,
        department: input.department,
        active: true,
        status: 'ACTIVE',
        roles: input.roles,
        active_jtis: [input.sessionJti],
        provisioned_at: now,
        idp_adapter: mode,
        entra_oid: input.entraOid,
        privileged_group_active: false,
        graph_request_id: graphRequestId
      };

      if (env.STATE_KV) {
        await env.STATE_KV.put(dirKey(input.sessionId), JSON.stringify(scimRecord), {
          expirationTtl: SESSION_TTL_SECONDS
        });
      } else {
        putEphemeral(ephemeralDirStore, dirKey(input.sessionId), JSON.stringify(scimRecord), SESSION_TTL_SECONDS);
      }

      return {
        scim_record: scimRecord,
        storage: env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge',
        external_sync: externalSync,
        graph_request_id: graphRequestId
      };
    },

    async elevateJit(input: ElevateJitInput) {
      let graphRequestId: string | undefined;
      let pamApiStatus: string | undefined;
      let externalSync = 'Edge PAM 15m JIT Token minted';
      let privilegedGroupActive = false;

      if (mode === 'entra-external-id' && input.entraOid) {
        if (env.PAM_API_URL) {
          try {
            const pamRes = await fetch(`${env.PAM_API_URL.replace(/\/$/, '')}/api/requests`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(env.PAM_API_TOKEN ? { Authorization: `Bearer ${env.PAM_API_TOKEN}` } : {})
              },
              body: JSON.stringify({
                userId: input.entraOid,
                justification: input.justification,
                durationMinutes: Math.round(input.ttlSeconds / 60)
              })
            });
            pamApiStatus = `pam-api HTTP ${pamRes.status}`;
          } catch {
            pamApiStatus = 'pam-api unreachable (Graph fallback active)';
          }
        }

        if (env.PRIVILEGED_GROUP_ID) {
          const graphToken = await getGraphAppToken(env);
          if (graphToken) {
            const gRes = await callGraph(
              graphToken,
              'POST',
              `/groups/${encodeURIComponent(env.PRIVILEGED_GROUP_ID)}/members/$ref`,
              { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${input.entraOid}` }
            );
            graphRequestId = gRes.requestId;
            // 204 = added, 400 = already a member
            privilegedGroupActive = gRes.ok || gRes.status === 400;
            externalSync = `Graph group add (${env.PRIVILEGED_GROUP_ID}) HTTP ${gRes.status}`;
          }
        }
      }

      let updated: ScimUserRecord | null = null;
      const raw = env.STATE_KV
        ? await env.STATE_KV.get(dirKey(input.sessionId))
        : getEphemeral(ephemeralDirStore, dirKey(input.sessionId));
      if (raw) {
        const record = JSON.parse(raw) as ScimUserRecord;
        if (!record.active_jtis.includes(input.jitJti)) {
          record.active_jtis.push(input.jitJti);
        }
        record.privileged_group_active = privilegedGroupActive || record.privileged_group_active;
        if (graphRequestId) record.graph_request_id = graphRequestId;
        if (env.STATE_KV) {
          await env.STATE_KV.put(dirKey(input.sessionId), JSON.stringify(record), {
            expirationTtl: SESSION_TTL_SECONDS
          });
        } else {
          putEphemeral(ephemeralDirStore, dirKey(input.sessionId), JSON.stringify(record), SESSION_TTL_SECONDS);
        }
        updated = record;
      }

      return {
        scim_record: updated,
        external_sync: externalSync,
        graph_request_id: graphRequestId,
        pam_api_status: pamApiStatus
      };
    },

    async isJtiRevoked(sessionId: string, jti: string) {
      if (!env.STATE_KV) {
        return getEphemeral(ephemeralRevokedStore, revokedKey(sessionId, jti)) !== null;
      }
      const marker = await env.STATE_KV.get(revokedKey(sessionId, jti));
      return marker !== null;
    },

    async revokeSessions(input: RevokeSessionsInput) {
      const now = new Date().toISOString();
      const allJtis = new Set<string>(input.jtiList.filter(Boolean));
      let graphRequestId: string | undefined;
      let externalSync = 'OpenID CAEP session-revoked written to Cloudflare STATE_KV';
      let targetOid = input.entraOid;

      const raw = env.STATE_KV
        ? await env.STATE_KV.get(dirKey(input.sessionId))
        : getEphemeral(ephemeralDirStore, dirKey(input.sessionId));
      if (raw) {
        const record = JSON.parse(raw) as ScimUserRecord;
        if (!targetOid && record.entra_oid) targetOid = record.entra_oid;
        for (const jti of record.active_jtis || []) {
          allJtis.add(jti);
        }
        record.active = false;
        record.status = 'REVOKED';
        record.privileged_group_active = false;
        record.revoked_at = now;
        if (env.STATE_KV) {
          await env.STATE_KV.put(dirKey(input.sessionId), JSON.stringify(record), {
            expirationTtl: SESSION_TTL_SECONDS
          });
        } else {
          putEphemeral(ephemeralDirStore, dirKey(input.sessionId), JSON.stringify(record), SESSION_TTL_SECONDS);
        }
      }

      const jtiArray = Array.from(allJtis);
      if (env.STATE_KV) {
        await Promise.all(
          jtiArray.map((jti) =>
            env.STATE_KV!.put(
              revokedKey(input.sessionId, jti),
              JSON.stringify({ revoked_at: now, reason: input.reason }),
              { expirationTtl: SESSION_TTL_SECONDS }
            )
          )
        );
      } else {
        for (const jti of jtiArray) {
          putEphemeral(
            ephemeralRevokedStore,
            revokedKey(input.sessionId, jti),
            JSON.stringify({ revoked_at: now, reason: input.reason }),
            SESSION_TTL_SECONDS
          );
        }
      }

      if (mode === 'entra-external-id' && targetOid) {
        const graphToken = await getGraphAppToken(env);
        if (graphToken) {
          const revRes = await callGraph(
            graphToken,
            'POST',
            `/users/${encodeURIComponent(targetOid)}/revokeSignInSessions`
          );
          graphRequestId = revRes.requestId;
          externalSync = `Graph POST /users/${targetOid}/revokeSignInSessions (HTTP ${revRes.status})`;

          if (env.PRIVILEGED_GROUP_ID) {
            await callGraph(
              graphToken,
              'DELETE',
              `/groups/${encodeURIComponent(env.PRIVILEGED_GROUP_ID)}/members/${encodeURIComponent(targetOid)}/$ref`
            );
          }
        }
      }

      return {
        revoked_jtis: Array.from(allJtis),
        external_sync: externalSync,
        storage: env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge',
        graph_request_id: graphRequestId
      };
    },

    async getDirectoryRecord(sessionId: string) {
      const raw = env.STATE_KV
        ? await env.STATE_KV.get(dirKey(sessionId))
        : getEphemeral(ephemeralDirStore, dirKey(sessionId));
      return raw ? (JSON.parse(raw) as ScimUserRecord) : null;
    }
  };
}
