import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { errors, newId } from '@universal-booking/core';
import { hashPassword, passwordProblems } from '@universal-booking/auth';
import { membershipRoles, permissions, resources, rolePermissions, roles, staffProfiles, tenantMemberships, users, type Tx } from '@universal-booking/database';
import { idParam, roleInput, staffInput, updateStaffInput } from '@universal-booking/contracts';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { slugify } from '../../http/crud';
import { findUserByEmail } from '../identity/sessions';
import { invalidatePrincipals } from '../identity/principals';

async function roleIdsForKeys(tx: Tx, keys: string[]) {
  const rows = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, keys));
  const missing = keys.filter((k) => !rows.some((r) => r.key === k));
  if (missing.length) throw errors.validation(`Unknown role: ${missing.join(', ')}`, [{ path: 'roleKeys', message: 'Unknown role' }]);
  if (keys.includes('customer')) throw errors.validation('Staff cannot be given the customer role.', [{ path: 'roleKeys', message: 'Not allowed' }]);
  return rows.map((r) => r.id);
}

/** Refuses changes that would leave the business without an active administrator. */
async function assertAnotherAdmin(tx: Tx, excludingMembershipId: string) {
  const [{ count }] = (await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, membershipRoles.membershipId))
    .where(and(eq(roles.key, 'business_admin'), eq(tenantMemberships.status, 'active'), ne(membershipRoles.membershipId, excludingMembershipId)))) as [{ count: number }];
  if (count === 0) throw errors.conflict('The business must keep at least one active administrator.');
}

async function staffView(tx: Tx, where?: ReturnType<typeof eq>) {
  const rows = await tx
    .select({ profile: staffProfiles, membershipStatus: tenantMemberships.status, userId: users.id, email: users.email, name: users.name, userStatus: users.status })
    .from(staffProfiles)
    .leftJoin(tenantMemberships, eq(tenantMemberships.id, staffProfiles.membershipId))
    .leftJoin(users, eq(users.id, tenantMemberships.userId))
    .where(where)
    .orderBy(asc(staffProfiles.sortOrder), asc(staffProfiles.displayName));
  const membershipIds = rows.map((r) => r.profile.membershipId).filter((x): x is string => !!x);
  const roleRows = membershipIds.length
    ? await tx.select({ membershipId: membershipRoles.membershipId, key: roles.key, name: roles.name }).from(membershipRoles).innerJoin(roles, eq(roles.id, membershipRoles.roleId)).where(inArray(membershipRoles.membershipId, membershipIds))
    : [];
  return rows.map((r) => ({
    ...r.profile,
    user: r.userId ? { id: r.userId, email: r.email, name: r.name, status: r.userStatus } : null,
    membershipStatus: r.membershipStatus,
    roles: roleRows.filter((x) => x.membershipId === r.profile.membershipId).map((x) => ({ key: x.key, name: x.name })),
  }));
}

export function registerStaffRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/permissions',
    summary: 'Permission catalog',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    async handler({ app }) {
      return app.db.system((tx) => tx.select().from(permissions).orderBy(asc(permissions.group), asc(permissions.key)));
    },
  });

  route({
    method: 'get',
    path: '/roles',
    summary: 'List roles with their permissions',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    async handler({ tx }) {
      return tx(async (t) => {
        const rows = await t.select().from(roles).orderBy(asc(roles.isSystem), asc(roles.name));
        const perms = await t.select().from(rolePermissions);
        return rows.map((r) => ({ ...r, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey) }));
      });
    },
  });

  route({
    method: 'post',
    path: '/roles',
    summary: 'Create a custom role',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    body: roleInput,
    async handler({ tx, tenant, body, audit }) {
      return tx(async (t) => {
        const key = body.key ?? slugify(body.name).replace(/-/g, '_').replace(/^[^a-z]+/, 'r_');
        const id = newId();
        await t.insert(roles).values({ id, tenantId: tenant.id, key, name: body.name, description: body.description });
        if (body.permissions.length) await t.insert(rolePermissions).values(body.permissions.map((permissionKey) => ({ tenantId: tenant.id, roleId: id, permissionKey })));
        await audit({ action: 'role.created', entityType: 'Role', entityId: id, changes: body }, t);
        return Reply.created({ id, key, name: body.name, description: body.description ?? null, isSystem: false, permissions: body.permissions });
      });
    },
  });

  route({
    method: 'patch',
    path: '/roles/:id',
    summary: 'Update a role and its permissions',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    params: idParam,
    body: roleInput.partial(),
    async handler({ tx, tenant, params, body, audit }) {
      const result = await tx(async (t) => {
        const [role] = await t.select().from(roles).where(eq(roles.id, params.id));
        if (!role) throw errors.notFound('Role');
        if (role.key === 'business_admin') throw errors.forbidden('The Business Administrator role cannot be changed.');
        if (role.key === 'customer' && body.permissions?.some((p) => p !== 'customer.self')) throw errors.validation('The customer role can only hold self-service permissions.');
        await t
          .update(roles)
          .set({ name: body.name ?? role.name, description: body.description ?? role.description })
          .where(eq(roles.id, role.id));
        if (body.permissions) {
          await t.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
          if (body.permissions.length) await t.insert(rolePermissions).values(body.permissions.map((permissionKey) => ({ tenantId: tenant.id, roleId: role.id, permissionKey })));
        }
        await audit({ action: 'role.updated', entityType: 'Role', entityId: role.id, changes: body }, t);
        return { ...role, ...body };
      });
      invalidatePrincipals();
      return result;
    },
  });

  route({
    method: 'delete',
    path: '/roles/:id',
    summary: 'Delete a custom role that is not in use',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    params: idParam,
    status: 204,
    async handler({ tx, params, audit }) {
      await tx(async (t) => {
        const [role] = await t.select().from(roles).where(eq(roles.id, params.id));
        if (!role) throw errors.notFound('Role');
        if (role.isSystem) throw errors.forbidden('System roles cannot be deleted.');
        const [used] = await t.select({ id: membershipRoles.membershipId }).from(membershipRoles).where(eq(membershipRoles.roleId, role.id)).limit(1);
        if (used) throw errors.conflict('This role is assigned to staff. Reassign them first.');
        await t.delete(roles).where(eq(roles.id, role.id));
        await audit({ action: 'role.deleted', entityType: 'Role', entityId: role.id }, t);
      });
      invalidatePrincipals();
      return Reply.noContent();
    },
  });

  route({
    method: 'get',
    path: '/staff',
    summary: 'List staff members',
    tags: ['Staff'],
    auth: 'user',
    anyPermission: ['staff.manage', 'resources.read'],
    async handler({ tx }) {
      return tx((t) => staffView(t));
    },
  });

  route({
    method: 'get',
    path: '/staff/:id',
    summary: 'Get a staff member',
    tags: ['Staff'],
    auth: 'user',
    anyPermission: ['staff.manage', 'resources.read'],
    params: idParam,
    async handler({ tx, params }) {
      const [row] = await tx((t) => staffView(t, eq(staffProfiles.id, params.id)));
      if (!row) throw errors.notFound('Staff member');
      return row;
    },
  });

  route({
    method: 'post',
    path: '/staff',
    summary: 'Invite or add a staff member',
    description: 'Creates the user account if needed, grants the roles, and optionally creates a bookable staff resource.',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    body: staffInput,
    async handler({ tx, tenant, body, identity, audit }) {
      if (body.password) {
        const problems = passwordProblems(body.password);
        if (problems.length) throw errors.validation('Password is too weak.', problems.map((message) => ({ path: 'password', message })));
      }
      const result = await tx(async (t) => {
        const roleIds = await roleIdsForKeys(t, body.roleKeys);
        let user = await findUserByEmail(t, body.email);
        if (!user) {
          [user] = await t
            .insert(users)
            .values({ email: body.email, name: body.name, phone: body.phone, passwordHash: body.password ? await hashPassword(body.password) : null, status: body.password ? 'active' : 'invited' })
            .returning();
        }
        const [existingMembership] = await t.select().from(tenantMemberships).where(eq(tenantMemberships.userId, user!.id));
        const membershipId = existingMembership?.id ?? newId();
        if (!existingMembership) await t.insert(tenantMemberships).values({ id: membershipId, tenantId: tenant.id, userId: user!.id, invitedById: identity.principalId });
        else await t.update(tenantMemberships).set({ status: 'active' }).where(eq(tenantMemberships.id, membershipId));
        await t.insert(membershipRoles).values(roleIds.map((roleId) => ({ tenantId: tenant.id, membershipId, roleId }))).onConflictDoNothing();

        const [existingProfile] = await t.select().from(staffProfiles).where(eq(staffProfiles.membershipId, membershipId));
        if (existingProfile) throw errors.conflict('This person is already a staff member.');
        let resourceId: string | null = null;
        if (body.bookable) {
          resourceId = newId();
          await t.insert(resources).values({ id: resourceId, tenantId: tenant.id, name: body.displayName ?? body.name, kind: 'staff', capacity: 1, imageUrl: body.avatarUrl });
        }
        const [profile] = await t
          .insert(staffProfiles)
          .values({ tenantId: tenant.id, membershipId, resourceId, displayName: body.displayName ?? body.name, title: body.title, bio: body.bio, email: body.email, phone: body.phone, avatarUrl: body.avatarUrl })
          .returning();
        await audit({ action: 'staff.added', entityType: 'StaffProfile', entityId: profile!.id, changes: { email: body.email, roles: body.roleKeys, bookable: body.bookable } }, t);
        return { profile: profile!, userId: user!.id, invited: !body.password && user!.status === 'invited' };
      });
      invalidatePrincipals(result.userId);
      const [view] = await tx((t) => staffView(t, eq(staffProfiles.id, result.profile.id)));
      return Reply.created({ ...view, invited: result.invited });
    },
  });

  route({
    method: 'patch',
    path: '/staff/:id',
    summary: 'Update a staff member, their roles or status',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    params: idParam,
    body: updateStaffInput,
    async handler({ tx, tenant, params, body, audit }) {
      const userId = await tx(async (t) => {
        const [profile] = await t.select().from(staffProfiles).where(eq(staffProfiles.id, params.id));
        if (!profile) throw errors.notFound('Staff member');
        const { roleKeys, status, bookable, name: _name, ...profileFields } = body;
        if (profile.membershipId && (roleKeys || status === 'inactive')) {
          const [adminRole] = await t
            .select({ id: membershipRoles.roleId })
            .from(membershipRoles)
            .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
            .where(and(eq(membershipRoles.membershipId, profile.membershipId), eq(roles.key, 'business_admin')));
          const losingAdmin = adminRole && (status === 'inactive' || (roleKeys && !roleKeys.includes('business_admin')));
          if (losingAdmin) await assertAnotherAdmin(t, profile.membershipId);
        }
        if (roleKeys && profile.membershipId) {
          const roleIds = await roleIdsForKeys(t, roleKeys);
          await t.delete(membershipRoles).where(eq(membershipRoles.membershipId, profile.membershipId));
          await t.insert(membershipRoles).values(roleIds.map((roleId) => ({ tenantId: tenant.id, membershipId: profile.membershipId!, roleId })));
        }
        if (status && profile.membershipId) await t.update(tenantMemberships).set({ status: status === 'active' ? 'active' : 'disabled' }).where(eq(tenantMemberships.id, profile.membershipId));
        let resourceId = profile.resourceId;
        if (bookable && !resourceId) {
          resourceId = newId();
          await t.insert(resources).values({ id: resourceId, tenantId: tenant.id, name: body.displayName ?? profile.displayName, kind: 'staff', capacity: 1 });
        } else if (bookable === false && resourceId) {
          await t.update(resources).set({ status: 'inactive' }).where(eq(resources.id, resourceId));
        }
        if (resourceId && (body.displayName || status)) {
          await t
            .update(resources)
            .set({ ...(body.displayName ? { name: body.displayName } : {}), ...(status ? { status: status === 'active' ? 'active' : 'inactive' } : {}) })
            .where(eq(resources.id, resourceId));
        }
        await t
          .update(staffProfiles)
          .set({ ...profileFields, resourceId, ...(status ? { status } : {}) })
          .where(eq(staffProfiles.id, profile.id));
        await audit({ action: 'staff.updated', entityType: 'StaffProfile', entityId: profile.id, changes: body }, t);
        if (!profile.membershipId) return null;
        const [m] = await t.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(eq(tenantMemberships.id, profile.membershipId));
        return m?.userId ?? null;
      });
      invalidatePrincipals(userId ?? undefined);
      const [view] = await tx((t) => staffView(t, eq(staffProfiles.id, params.id)));
      return view;
    },
  });

  route({
    method: 'delete',
    path: '/staff/:id',
    summary: 'Remove a staff member (revokes access; history is kept)',
    tags: ['Staff'],
    auth: 'user',
    permission: 'staff.manage',
    params: idParam,
    status: 204,
    async handler({ tx, params, identity, audit }) {
      const userId = await tx(async (t) => {
        const [profile] = await t.select().from(staffProfiles).where(eq(staffProfiles.id, params.id));
        if (!profile) throw errors.notFound('Staff member');
        let memberUserId: string | null = null;
        if (profile.membershipId) {
          const [m] = await t.select().from(tenantMemberships).where(eq(tenantMemberships.id, profile.membershipId));
          memberUserId = m?.userId ?? null;
          if (memberUserId === identity.principalId) throw errors.conflict('You cannot remove yourself.');
          await assertAnotherAdmin(t, profile.membershipId);
          await t.update(tenantMemberships).set({ status: 'disabled' }).where(eq(tenantMemberships.id, profile.membershipId));
          await t.delete(membershipRoles).where(eq(membershipRoles.membershipId, profile.membershipId));
        }
        if (profile.resourceId) await t.update(resources).set({ status: 'inactive' }).where(eq(resources.id, profile.resourceId));
        await t.update(staffProfiles).set({ status: 'inactive' }).where(eq(staffProfiles.id, profile.id));
        await audit({ action: 'staff.removed', entityType: 'StaffProfile', entityId: profile.id }, t);
        return memberUserId;
      });
      invalidatePrincipals(userId ?? undefined);
      return Reply.noContent();
    },
  });
}
