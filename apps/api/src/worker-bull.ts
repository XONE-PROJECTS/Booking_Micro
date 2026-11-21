import { Queue, Worker } from 'bullmq';
import type { AppContext } from './context';
import { JOB_NAMES, runJob, type JobName } from './jobs/queue-workers';

export async function startBullWorkers(ctx: AppContext, redisUrl: string): Promise<{ close: () => Promise<void> }> {
  const connection = { url: redisUrl };
  const queues: Queue[] = [];
  const workers: Worker[] = [];

  for (const name of JOB_NAMES) {
    const queue = new Queue(name, { connection });
    queues.push(queue);
    workers.push(
      new Worker(
        name,
        async () => {
          await runJob(ctx, name as JobName);
        },
        { connection },
      ),
    );
  }

  const intervals: Record<JobName, number> = {
    'hold.cleanup': ctx.env.HOLD_CLEANUP_INTERVAL_SECONDS,
    'outbox.fanout': Math.min(ctx.env.HOLD_CLEANUP_INTERVAL_SECONDS, 30),
    'webhooks.deliver': 15,
    'notifications.deliver': 20,
    'notifications.reminders': 3600,
    'payments.recheck': 300,
  };

  const timers = JOB_NAMES.map((name) =>
    setInterval(() => void queues.find((q) => q.name === name)?.add('tick', {}), intervals[name] * 1000).unref(),
  );

  return {
    async close() {
      timers.forEach(clearInterval);
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(queues.map((q) => q.close()));
    },
  };
}