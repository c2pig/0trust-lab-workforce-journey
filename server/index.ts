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

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    process.exit(0);
  }, 5000);
  forceExitTimer.unref?.();

  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  server.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
