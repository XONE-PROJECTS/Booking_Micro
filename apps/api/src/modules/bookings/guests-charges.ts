import { and, eq, sql } from 'drizzle-orm';
import { errors, newId } from '@universal-booking/core';
import { bookingCharges, bookingGuests, bookings } from '@universal-booking/database';
import { bookingChargeInput, guestInput } from '@universal-booking/contracts';
import type { z } from 'zod';
import type { Tx } from '@universal-booking/database';

type GuestBody = z.infer<typeof guestInput>;
type ChargeBody = z.infer<typeof bookingChargeInput>;

export async function listGuests(tx: Tx, tenantId: string, bookingId: string) {
  return tx.select().from(bookingGuests).where(and(eq(bookingGuests.tenantId, tenantId), eq(bookingGuests.bookingId, bookingId)));
}

export async function addGuests(tx: Tx, tenantId: string, bookingId: string, guests: GuestBody[]) {
  const [b] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)));
  if (!b) throw errors.notFound('Booking');
  const rows = guests.map((g, i) => ({
    id: newId(),
    tenantId,
    bookingId,
    guestType: g.guestType ?? null,
    firstName: g.firstName,
    lastName: g.lastName ?? null,
    email: g.email ?? null,
    phone: g.phone ?? null,
    isPrimary: i === 0,
    attributes: g.attributes ?? {},
  }));
  if (rows.length) await tx.insert(bookingGuests).values(rows);
  return rows;
}

export async function deleteGuest(tx: Tx, tenantId: string, bookingId: string, guestId: string) {
  const [row] = await tx
    .select({ id: bookingGuests.id })
    .from(bookingGuests)
    .where(and(eq(bookingGuests.tenantId, tenantId), eq(bookingGuests.bookingId, bookingId), eq(bookingGuests.id, guestId)));
  if (!row) throw errors.notFound('Guest');
  await tx.delete(bookingGuests).where(eq(bookingGuests.id, guestId));
}

export async function listCharges(tx: Tx, tenantId: string, bookingId: string) {
  return tx.select().from(bookingCharges).where(and(eq(bookingCharges.tenantId, tenantId), eq(bookingCharges.bookingId, bookingId)));
}

export async function addCharge(tx: Tx, tenantId: string, bookingId: string, body: ChargeBody, createdById?: string | null) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)));
  if (!b) throw errors.notFound('Booking');
  const id = newId();
  await tx.insert(bookingCharges).values({
    id,
    tenantId,
    bookingId,
    kind: body.kind,
    description: body.description,
    amount: body.amount,
    status: 'open',
    createdById: createdById ?? null,
  });
  const openTotal = await tx
    .select({ sum: sql<string>`coalesce(sum(${bookingCharges.amount}::numeric), 0)::text` })
    .from(bookingCharges)
    .where(and(eq(bookingCharges.bookingId, bookingId), eq(bookingCharges.status, 'open')));
  await tx.update(bookings).set({ chargesTotal: openTotal[0]?.sum ?? '0' }).where(eq(bookings.id, bookingId));
  const [row] = await tx.select().from(bookingCharges).where(eq(bookingCharges.id, id));
  return row!;
}