import { eq, sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { migrationUrl } from './env';
import { createDatabase } from '../client';
import { tenants, users } from '../schema';
import { provisionTenant, syncPermissions } from '../seed';

/**
 * Base seed: permission catalog, the platform administrator and the default tenant.
 * Demo businesses are created by `npm run seed:demo -w @universal-booking/api`.
 */
const client = createDatabase({ url: migrationUrl(), poolMax: 1 });
try {
  await client.system(async (tx) => {
    await syncPermissions(tx);

    const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
    let [admin] = await tx.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    if (!admin) {
      [admin] = await tx
        .insert(users)
        .values({ email, name: 'Platform Administrator', passwordHash: await hash(password), isPlatformAdmin: true, emailVerifiedAt: new Date() })
        .returning();
      console.log(`Created platform administrator ${email}`);
    }

    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'default';
    const [existing] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
    if (!existing) {
      await provisionTenant(tx, {
        slug,
        name: process.env.DEFAULT_TENANT_NAME ?? 'My Business',
        timezone: process.env.DEFAULT_TIMEZONE,
        currency: process.env.DEFAULT_CURRENCY,
        locale: process.env.DEFAULT_LOCALE,
        ownerUserId: admin!.id,
      });
      console.log(`Created tenant "${slug}"`);
    }
  });
  console.log('Seed complete.');
} finally {
  await client.close();
}
