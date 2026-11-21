import PgBoss from 'pg-boss';
import { createAppContext } from './bootstrap';
import { JOB_NAMES, runJob, type JobName } from './jobs/queue-workers';
import { startBullWorkers } from './worker-bull';

/** Background process: outbox fan-out, webhook delivery, and hold cleanup. */
async function main() {
  const ctx = await createAppContext();
  if (!ctx.env.JOBS_ENABLED) {
    ctx.log.warn('JOBS_ENABLED=false; worker exiting.');
    process.exit(0);
  }

  let bullClose: (() => Promise<void>) | null = null;
  if (ctx.env.REDIS_ENABLED && ctx.env.REDIS_URL) {
    const bull = await startBullWorkers(ctx, ctx.env.REDIS_URL);
    bullClose = () => bull.close();
    ctx.log.info('Worker started (BullMQ).');
  } else {
    const boss = new PgBoss({ connectionString: ctx.env.DATABASE_URL, application_name: 'universal-booking-worker' });
    await boss.start();
    ctx.log.info('Worker started (pg-boss).');

    for (const q of JOB_NAMES) await boss.createQueue(q);

    for (const name of JOB_NAMES) {
      await boss.work(name, async () => {
        await runJob(ctx, name as JobName);
      });
    }

    const intervals: Record<JobName, number> = {
      'hold.cleanup': ctx.env.HOLD_CLEANUP_INTERVAL_SECONDS,
      'outbox.fanout': Math.min(ctx.env.HOLD_CLEANUP_INTERVAL_SECONDS, 30),
      'webhooks.deliver': 15,
      'notifications.deliver': 20,
      'notifications.reminders': 3600,
      'payments.recheck': 300,
    };

    const tick = (queue: JobName, everySeconds: number) =>
      setInterval(() => void boss.send(queue, {}), everySeconds * 1000).unref();

    for (const name of JOB_NAMES) tick(name, intervals[name]);

    const shutdownBoss = async () => {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await ctx.db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdownBoss());
    process.on('SIGTERM', () => void shutdownBoss());
    return;
  }

  const shutdown = async () => {
    if (bullClose) await bullClose();
    await ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});