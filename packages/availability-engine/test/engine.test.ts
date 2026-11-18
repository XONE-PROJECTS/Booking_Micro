import { describe, expect, it } from 'vitest';
import { expand, parseBookingDefinition, presetDefinition, zoned, type BookingDefinition } from '@universal-booking/core';
import { availabilityCalendar, listSlots, peakUsage, resolveDuration, searchAvailability, type AvailabilityContext, type ExistingAllocation, type ResourceInfo } from '../src';

const tz = 'Asia/Manila';
const room = (id: string, capacity = 4): ResourceInfo => ({ id, name: `Room ${id}`, status: 'active', capacity, quantity: 1, schedule: null, sortOrder: 0 });

function ctx(def: BookingDefinition, overrides: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    timezone: tz,
    now: new Date('2026-11-01T00:00:00Z'),
    definition: def,
    businessHours: [],
    serviceWindows: [],
    sessions: [],
    resources: [],
    periods: [],
    allocations: [],
    capacities: [],
    ...overrides,
  };
}

const alloc = (resourceId: string | null, start: Date, end: Date, quantity = 1, def?: BookingDefinition): ExistingAllocation => ({
  resourceId,
  period: { start, end },
  blocked: def ? expand({ start, end }, def.buffers.beforeMinutes, def.buffers.afterMinutes) : { start, end },
  quantity,
  exclusive: true,
});

describe('accommodation', () => {
  const def = presetDefinition('accommodation');
  it('computes nights with check-out exclusive', () => {
    const d = resolveDuration(def, { startDate: '2026-12-01', endDate: '2026-12-04' }, tz);
    expect(d.units.nights).toBe(3);
    expect(d.dates).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
  });
  it('allows same-day turnover but blocks overlaps', () => {
    const existing = alloc('101', zoned('2026-12-01', '00:00', tz), zoned('2026-12-04', '00:00', tz));
    const c = ctx(def, { resources: [room('101')], allocations: [existing] });
    expect(searchAvailability(c, { startDate: '2026-12-04', endDate: '2026-12-06', participants: { adults: 2 } }).available).toBe(true);
    const clash = searchAvailability(c, { startDate: '2026-12-03', endDate: '2026-12-05', participants: { adults: 2 } });
    expect(clash.available).toBe(false);
    expect(clash.reasons).toContain('conflict');
  });
  it('needs as many free rooms as requested', () => {
    const existing = alloc('101', zoned('2026-12-01', '00:00', tz), zoned('2026-12-04', '00:00', tz));
    const c = ctx(def, { resources: [room('101'), room('102')], allocations: [existing] });
    expect(searchAvailability(c, { startDate: '2026-12-02', endDate: '2026-12-03', quantity: 1, participants: { adults: 1 } }).available).toBe(true);
    expect(searchAvailability(c, { startDate: '2026-12-02', endDate: '2026-12-03', quantity: 2, participants: { adults: 2 } }).available).toBe(false);
  });
  it('filters rooms by party size', () => {
    const c = ctx(def, { resources: [room('small', 2)] });
    expect(searchAvailability(c, { startDate: '2026-12-02', endDate: '2026-12-03', participants: { adults: 3 } }).reasons).toContain('no_resources');
  });
  it('respects blackouts and maintenance', () => {
    const c = ctx(def, {
      resources: [room('101')],
      periods: [{ targetType: 'resource', targetId: '101', kind: 'closed', interval: { start: zoned('2026-12-10', '00:00', tz), end: zoned('2026-12-11', '00:00', tz) } }],
    });
    expect(searchAvailability(c, { startDate: '2026-12-09', endDate: '2026-12-12', participants: { adults: 1 } }).available).toBe(false);
    expect(searchAvailability(c, { startDate: '2026-12-11', endDate: '2026-12-12', participants: { adults: 1 } }).available).toBe(true);
  });
  it('enforces minimum stay', () => {
    const strict = parseBookingDefinition({ ...def, duration: { ...def.duration, min: 2 } });
    expect(() => searchAvailability(ctx(strict, { resources: [room('101')] }), { startDate: '2026-12-01', endDate: '2026-12-02', participants: { adults: 1 } })).toThrow(/Minimum/);
  });
});

describe('appointments', () => {
  const def = parseBookingDefinition({ ...presetDefinition('appointment'), buffers: { beforeMinutes: 0, afterMinutes: 15 }, limits: { leadTimeMinutes: 0, horizonDays: 365 } });
  const doctor: ResourceInfo = {
    id: 'doc',
    name: 'Dr. A',
    status: 'active',
    capacity: null,
    quantity: 1,
    schedule: [{ dayOfWeek: 2, startTime: '09:00', endTime: '12:00' }],
    breaks: [{ dayOfWeek: 2, startTime: '10:00', endTime: '10:30' }],
    sortOrder: 0,
  };
  it('generates slots inside the schedule and outside breaks', () => {
    const slots = listSlots(ctx(def, { resources: [doctor] }), { date: '2026-12-01' });
    expect(slots.map((s) => s.localStart.slice(11, 16))).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });
  it('blocks slots inside the after-buffer of an existing booking', () => {
    const existing = alloc('doc', zoned('2026-12-01', '09:00', tz), zoned('2026-12-01', '09:30', tz), 1, def);
    const slots = listSlots(ctx(def, { resources: [doctor], allocations: [existing] }), { date: '2026-12-01' });
    const byTime = Object.fromEntries(slots.map((s) => [s.localStart.slice(11, 16), s.available]));
    expect(byTime['09:00']).toBe(false);
    expect(byTime['09:30']).toBe(false);
    expect(byTime['10:30']).toBe(true);
  });
  it('applies lead time', () => {
    const now = zoned('2026-12-01', '09:10', tz);
    const strict = parseBookingDefinition({ ...def, limits: { leadTimeMinutes: 60, horizonDays: 30 } });
    const slots = listSlots(ctx(strict, { resources: [doctor], now }), { date: '2026-12-01' });
    expect(slots.filter((s) => s.available).map((s) => s.localStart.slice(11, 16))).toEqual(['10:30', '11:00', '11:30']);
  });
  it('expands recurring bookings in local time', () => {
    const recurring = parseBookingDefinition({ ...def, recurrence: { enabled: true, frequencies: ['weekly'], maxOccurrences: 4 } });
    const d = resolveDuration(recurring, { startDate: '2026-12-01', startTime: '09:00', recurrence: { frequency: 'weekly', count: 3 } }, tz);
    expect(d.periods).toHaveLength(3);
    expect(d.periods[2]!.start.toISOString()).toBe(zoned('2026-12-15', '09:00', tz).toISOString());
  });
});

describe('capacity', () => {
  const def = parseBookingDefinition({ ...presetDefinition('capacity'), limits: { leadTimeMinutes: 0, horizonDays: 365 } });
  it('computes peak concurrent usage', () => {
    const a = [alloc(null, new Date('2026-12-01T01:00Z'), new Date('2026-12-01T03:00Z'), 5), alloc(null, new Date('2026-12-01T02:00Z'), new Date('2026-12-01T04:00Z'), 4)];
    expect(peakUsage(a, null, { start: new Date('2026-12-01T00:00Z'), end: new Date('2026-12-01T05:00Z') })).toBe(9);
    expect(peakUsage(a, null, { start: new Date('2026-12-01T03:00Z'), end: new Date('2026-12-01T05:00Z') })).toBe(4);
  });
  it('rejects when the final seats are taken', () => {
    const session = { dayOfWeek: 2, startTime: '18:00', endTime: '19:00', capacity: 10 };
    const taken = alloc(null, zoned('2026-12-01', '18:00', tz), zoned('2026-12-01', '19:00', tz), 9);
    const c = ctx(def, { sessions: [session], allocations: [taken] });
    const slots = listSlots(c, { date: '2026-12-01', participants: { participants: 1 } });
    expect(slots[0]!.available).toBe(true);
    expect(slots[0]!.remaining).toBe(1);
    expect(listSlots(c, { date: '2026-12-01', participants: { participants: 2 } })[0]!.available).toBe(false);
  });
  it('honors daily capacity', () => {
    const limited = parseBookingDefinition({ ...def, limits: { ...def.limits, dailyCapacity: 3 } });
    const c = ctx(limited, { sessions: [{ dayOfWeek: 2, startTime: '18:00', endTime: '19:00', capacity: 10 }], dailyBookedCounts: { '2026-12-01': 3 } });
    expect(listSlots(c, { date: '2026-12-01', participants: { participants: 1 } })[0]!.available).toBe(false);
  });
});

describe('pooled rentals and calendar', () => {
  const def = parseBookingDefinition({ ...presetDefinition('rental'), limits: { leadTimeMinutes: 0, horizonDays: 365 } });
  const kayaks: ResourceInfo = { id: 'kayak', name: 'Kayak', status: 'active', capacity: null, quantity: 3, schedule: null, sortOrder: 0 };
  it('counts days inclusively and checks pooled stock', () => {
    const existing = { ...alloc('kayak', zoned('2026-12-01', '00:00', tz), zoned('2026-12-03', '00:00', tz), 2), exclusive: false };
    const c = ctx(def, { resources: [kayaks], allocations: [existing] });
    const r = searchAvailability(c, { startDate: '2026-12-02', endDate: '2026-12-02', quantity: 2 });
    expect(r.duration.units.days).toBe(1);
    expect(r.available).toBe(false);
    expect(searchAvailability(c, { startDate: '2026-12-02', endDate: '2026-12-02', quantity: 1 }).available).toBe(true);
  });
  it('produces a calendar', () => {
    const days = availabilityCalendar(ctx(def, { resources: [kayaks] }), { from: '2026-12-01', to: '2026-12-04', quantity: 1 });
    expect(days.map((d) => d.available)).toEqual([true, true, true]);
  });
});
