import { serve } from '@hono/node-server';
import { createCloudRunApp } from './app';

const port = Number(process.env.PORT || 8080);
const app = createCloudRunApp();
const labName = process.env.LAB_SLUG || 'api';

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0'
  },
  (info) => {
    console.log(
      `[0trust-lab-${labName}] Cloud Run API listening on http://0.0.0.0:${info.port}`
    );
  }
);

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
