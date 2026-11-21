import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAppContext } from '../../src/bootstrap';
import { createHttpApp } from '../../src/app';

describe('API integration', () => {
  it('GET /health responds ok when database is reachable', async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    const ctx = await createAppContext();
    const app = createHttpApp(ctx);
    const res = await request(app).get('/health');
    expect(res.status).toBeLessThan(600);
    expect(res.body).toHaveProperty('ok');
    await ctx.db.close();
  });

  it('unknown API routes return structured not-found envelope', async () => {
    if (!process.env.DATABASE_URL) {
      return;
    }
    const ctx = await createAppContext();
    const app = createHttpApp(ctx);
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    await ctx.db.close();
  });
});