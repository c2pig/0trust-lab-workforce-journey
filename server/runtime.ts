import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  onRequest as observabilityMiddleware,
  type EdgeMiddlewareEnv
} from '../functions/api/_middleware';
import { createKvAdapter, type KVNamespace } from './kvAdapter';

export interface BaseCloudRunEnv extends EdgeMiddlewareEnv {
  STATE_KV?: KVNamespace;
  LAB_SLUG?: string;
  LAB_ROUTER_SECRET?: string;
  FIRESTORE_COLLECTION?: string;
}

export type PagesHandler<TEnv extends BaseCloudRunEnv = BaseCloudRunEnv> = (context: {
  request: Request;
  env: TEnv;
}) => Promise<Response>;

export type WrappedRouteHandler = (c: { req: { raw: Request } }) => Promise<Response>;

export interface CreateBaseLabAppOptions<TEnv extends BaseCloudRunEnv = BaseCloudRunEnv> {
  labSlug: string;
  env?: TEnv;
  kv?: KVNamespace;
  extraEnv?: Partial<TEnv>;
  registerRoutes: (
    app: Hono,
    wrap: (handler: PagesHandler<TEnv>) => WrappedRouteHandler,
    runtimeEnv: TEnv
  ) => void;
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

export function createBaseLabApp<TEnv extends BaseCloudRunEnv = BaseCloudRunEnv>(
  options: CreateBaseLabAppOptions<TEnv>
): Hono {
  const app = new Hono();

  const defaultBaseEnv: BaseCloudRunEnv = {
    ENVIRONMENT: process.env.ENVIRONMENT || (process.env.K_SERVICE ? 'production' : 'development'),
    LAB_SLUG: process.env.LAB_SLUG || options.labSlug,
    LAB_ROUTER_SECRET: process.env.LAB_ROUTER_SECRET,
    FIRESTORE_COLLECTION: process.env.FIRESTORE_COLLECTION || 'kv_state',
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
    OTLP_AUTH_HEADER: process.env.OTLP_AUTH_HEADER
  };

  const baseEnv: TEnv =
    options.env ??
    ({
      ...defaultBaseEnv,
      ...(options.extraEnv ?? {})
    } as TEnv);

  const labSlug = baseEnv.LAB_SLUG || options.labSlug;
  const kv =
    options.kv ??
    baseEnv.STATE_KV ??
    createKvAdapter({
      labSlug,
      collectionName: baseEnv.FIRESTORE_COLLECTION || 'kv_state'
    });

  const runtimeEnv: TEnv = {
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

  const wrap = (handler: PagesHandler<TEnv>): WrappedRouteHandler => {
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

  options.registerRoutes(app, wrap, runtimeEnv);

  return app;
}
