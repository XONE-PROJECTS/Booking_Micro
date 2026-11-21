import { createServer } from 'node:http';
import { createAppContext } from './bootstrap';
import { createHttpApp } from './app';
import { attachRealtime } from './realtime/socket';

async function main() {
  const ctx = await createAppContext();
  const app = createHttpApp(ctx);
  const httpServer = createServer(app);
  ctx.realtime = attachRealtime(httpServer, ctx.tokens, ctx.log, ctx.env.REALTIME_ENABLED);
  const server = httpServer.listen(ctx.env.PORT, () => {
    ctx.log.info({ port: ctx.env.PORT, prefix: ctx.env.API_PREFIX, mode: ctx.env.APP_DEPLOYMENT_MODE }, 'API listening');
  });

  const shutdown = async (signal: string) => {
    ctx.log.info({ signal }, 'Shutting down');
    server.close();
    await ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});