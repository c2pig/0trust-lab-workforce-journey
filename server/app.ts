import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  onRequest as observabilityMiddleware,
  type EdgeMiddlewareEnv
} from '../functions/api/_middleware';
import type { KVNamespace, WorkforceJourneyEnv } from '../functions/api/lib/idpAdapter';
import { onRequestGet as configGet } from '../functions/api/workforce-journey/config';
import { onRequestGet as entraCallbackGet } from '../functions/api/workforce-journey/entra/callback';
import { onRequestGet as entraLoginGet } from '../functions/api/workforce-journey/entra/login';
import { onRequestPost as jitDecisionPost } from '../functions/api/workforce-journey/jit-decision';
import { onRequestPost as jitSubmitPost } from '../functions/api/workforce-journey/jit-submit';
import { onRequestPost as loginProvisionPost } from '../functions/api/workforce-journey/login-provision';
import { onRequestPost as logoutPost } from '../functions/api/workforce-journey/logout';
import { onRequestPost as protectedCallPost } from '../functions/api/workforce-journey/protected-call';
import { onRequestPost as requestJitPost } from '../functions/api/workforce-journey/request-jit';
import { createKvAdapter } from './kvAdapter';

export interface CloudRunEnv extends WorkforceJourneyEnv, EdgeMiddlewareEnv {
  LAB_SLUG?: string;
  LAB_ROUTER_SECRET?: string;
  FIRESTORE_COLLECTION?: string;
}

export function verifyRouterSecret(
  provided: string | null | undefined,
  expected: string | undefined
): boolean {
  if (!provided || !expected) {
    return false;
  }
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

type PagesHandler = (context: {
  request: Request;
  env: WorkforceJourneyEnv;
}) => Promise<Response>;

export function createCloudRunApp(options?: {
  env?: CloudRunEnv;
  kv?: KVNamespace;
}): Hono {
  const app = new Hono();
  const baseEnv: CloudRunEnv = options?.env ?? {
    ENVIRONMENT: process.env.ENVIRONMENT || (process.env.K_SERVICE ? 'production' : 'development'),
    LAB_SLUG: process.env.LAB_SLUG || 'workforce-journey',
    LAB_ROUTER_SECRET: process.env.LAB_ROUTER_SECRET,
    FIRESTORE_COLLECTION: process.env.FIRESTORE_COLLECTION || 'kv_state',
    LAB1_JWT_SECRET: process.env.LAB1_JWT_SECRET,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
    OTLP_AUTH_HEADER: process.env.OTLP_AUTH_HEADER,
    ENTRA_EXT_TENANT_ID: process.env.ENTRA_EXT_TENANT_ID,
    ENTRA_EXT_CLIENT_ID: process.env.ENTRA_EXT_CLIENT_ID,
    ENTRA_EXT_CLIENT_SECRET: process.env.ENTRA_EXT_CLIENT_SECRET,
    ENTRA_EXT_AUTHORITY: process.env.ENTRA_EXT_AUTHORITY,
    PRIVILEGED_GROUP_ID: process.env.PRIVILEGED_GROUP_ID,
    PAM_API_URL: process.env.PAM_API_URL,
    PAM_API_TOKEN: process.env.PAM_API_TOKEN
  };

  const labSlug = baseEnv.LAB_SLUG || 'workforce-journey';
  const kv =
    options?.kv ??
    baseEnv.STATE_KV ??
    createKvAdapter({
      labSlug,
      collectionName: baseEnv.FIRESTORE_COLLECTION || 'kv_state'
    });

  const runtimeEnv: CloudRunEnv = {
    ...baseEnv,
    STATE_KV: kv
  };

  // Cloud Run startup/liveness probe — exempt from X-Lab-Router-Secret, no Firestore/secret access
  app.get('/healthz', (c) => {
    return c.json({ ok: true, lab: labSlug }, 200);
  });

  // Fail-closed constant-time X-Lab-Router-Secret validation on all /api/* routes
  app.use('/api/*', async (c, next) => {
    const isProduction = baseEnv.ENVIRONMENT === 'production';
    const expectedSecret = baseEnv.LAB_ROUTER_SECRET;
    const mustEnforce = isProduction || Boolean(expectedSecret);

    if (mustEnforce) {
      const providedSecret = c.req.header('x-lab-router-secret');
      if (!verifyRouterSecret(providedSecret, expectedSecret)) {
        return c.json({ error: 'FORBIDDEN_DIRECT_ORIGIN' }, 403);
      }
    }

    await next();
  });

  const wrap = (handler: PagesHandler) => {
    return async (c: { req: { raw: Request } }): Promise<Response> => {
      return observabilityMiddleware({
        request: c.req.raw,
        env: runtimeEnv,
        next: () => handler({ request: c.req.raw, env: runtimeEnv }),
        waitUntil: (promise: Promise<unknown>) => {
          promise.catch(() => {
            // Non-blocking background OTLP export; never crash request or process
          });
        }
      });
    };
  };

  app.get('/api/workforce-journey/config', wrap(configGet));
  app.post('/api/workforce-journey/login-provision', wrap(loginProvisionPost));
  app.post('/api/workforce-journey/jit-submit', wrap(jitSubmitPost));
  app.post('/api/workforce-journey/jit-decision', wrap(jitDecisionPost));
  app.post('/api/workforce-journey/request-jit', wrap(requestJitPost));
  app.post('/api/workforce-journey/protected-call', wrap(protectedCallPost));
  app.post('/api/workforce-journey/logout', wrap(logoutPost));
  app.get('/api/workforce-journey/entra/login', wrap(entraLoginGet));
  app.get('/api/workforce-journey/entra/callback', wrap(entraCallbackGet));

  return app;
}
