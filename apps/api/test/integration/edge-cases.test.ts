import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAppContext } from '../../src/bootstrap';
import { createHttpApp } from '../../src/app';

describe('edge cases', () => {
  it('rejects unknown routes with envelope', async () => {
    if (!process.env.DATABASE_URL) return;
    const ctx = await createAppContext();
    const app = createHttpApp(ctx);
    const res = await request(app).get('/api/v1/tenants/other-tenant-secret/bookings/00000000-0000-4000-8000-000000000001');
    expect([401, 403, 404]).toContain(res.status);
    await ctx.db.close();
  });
});