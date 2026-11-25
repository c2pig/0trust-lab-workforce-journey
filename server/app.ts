import type { Hono } from 'hono';
import type { WorkforceJourneyEnv } from '../functions/api/lib/idpAdapter';
import { onRequestGet as configGet } from '../functions/api/workforce-journey/config';
import { onRequestGet as entraCallbackGet } from '../functions/api/workforce-journey/entra/callback';
import { onRequestGet as entraLoginGet } from '../functions/api/workforce-journey/entra/login';
import { onRequestPost as jitDecisionPost } from '../functions/api/workforce-journey/jit-decision';
import { onRequestPost as jitSubmitPost } from '../functions/api/workforce-journey/jit-submit';
import { onRequestPost as loginProvisionPost } from '../functions/api/workforce-journey/login-provision';
import { onRequestPost as logoutPost } from '../functions/api/workforce-journey/logout';
import { onRequestPost as protectedCallPost } from '../functions/api/workforce-journey/protected-call';
import { onRequestPost as requestJitPost } from '../functions/api/workforce-journey/request-jit';
import type { KVNamespace } from './kvAdapter';
import { createBaseLabApp, type BaseCloudRunEnv } from './runtime';

export { verifyRouterSecret } from './runtime';

export interface CloudRunEnv extends WorkforceJourneyEnv, BaseCloudRunEnv {}

export function createCloudRunApp(options?: {
  env?: CloudRunEnv;
  kv?: KVNamespace;
}): Hono {
  return createBaseLabApp<CloudRunEnv>({
    labSlug: 'workforce-journey',
    env: options?.env,
    kv: options?.kv,
    extraEnv: {
      LAB1_JWT_SECRET: process.env.LAB1_JWT_SECRET,
      ENTRA_EXT_TENANT_ID: process.env.ENTRA_EXT_TENANT_ID,
      ENTRA_EXT_CLIENT_ID: process.env.ENTRA_EXT_CLIENT_ID,
      ENTRA_EXT_CLIENT_SECRET: process.env.ENTRA_EXT_CLIENT_SECRET,
      ENTRA_EXT_AUTHORITY: process.env.ENTRA_EXT_AUTHORITY,
      PRIVILEGED_GROUP_ID: process.env.PRIVILEGED_GROUP_ID,
      PAM_API_URL: process.env.PAM_API_URL,
      PAM_API_TOKEN: process.env.PAM_API_TOKEN
    },
    registerRoutes: (app, wrap) => {
      app.get('/api/workforce-journey/config', wrap(configGet));
      app.post('/api/workforce-journey/login-provision', wrap(loginProvisionPost));
      app.post('/api/workforce-journey/jit-submit', wrap(jitSubmitPost));
      app.post('/api/workforce-journey/jit-decision', wrap(jitDecisionPost));
      app.post('/api/workforce-journey/request-jit', wrap(requestJitPost));
      app.post('/api/workforce-journey/protected-call', wrap(protectedCallPost));
      app.post('/api/workforce-journey/logout', wrap(logoutPost));
      app.get('/api/workforce-journey/entra/login', wrap(entraLoginGet));
      app.get('/api/workforce-journey/entra/callback', wrap(entraCallbackGet));
    }
  });
}
