import type { Express } from 'express';

export async function createBookingApp(): Promise<{ app: Express; close: () => Promise<void> }> {
  const { createAppContext } = await import('@universal-booking/api/bootstrap');
  const { createHttpApp } = await import('@universal-booking/api/app');
  const ctx = await createAppContext();
  const app = createHttpApp(ctx);
  return {
    app,
    close: () => ctx.db.close(),
  };
}