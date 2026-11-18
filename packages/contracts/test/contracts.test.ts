import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBookingInput, maintenanceInput, OpenApiRegistry, serviceInput } from '../src';

describe('contracts', () => {
  it('parses the blueprint booking request', () => {
    const r = createBookingInput.parse({
      serviceId: '0190a0a0-0000-7000-8000-000000000001',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      quantity: 1,
      participants: { adults: 2, children: 1 },
      customer: { firstName: 'Juan', lastName: 'Dela Cruz', email: 'JUAN@Example.com', phone: '+63 917 000 0000' },
      answers: { special_request: 'Late arrival' },
    });
    expect(r.customer?.email).toBe('juan@example.com');
    expect(r.hold).toBe(false);
  });

  it('ignores client-supplied price and payment fields', () => {
    const r = createBookingInput.parse({ serviceId: '0190a0a0-0000-7000-8000-000000000001', startDate: '2026-12-01', total: '1.00', paymentStatus: 'paid' } as never);
    expect(r).not.toHaveProperty('total');
    expect(r).not.toHaveProperty('paymentStatus');
  });

  it('validates ranges and money', () => {
    expect(maintenanceInput.safeParse({ reason: 'x', startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }).success).toBe(false);
    expect(serviceInput.safeParse({ name: 'Room', basePrice: '-5' }).success).toBe(false);
    expect(serviceInput.parse({ name: 'Room', basePrice: 3500 }).basePrice).toBe('3500');
  });

  it('builds an OpenAPI document', () => {
    const reg = new OpenApiRegistry();
    reg.add({ method: 'post', path: '/bookings', summary: 'Create booking', tags: ['Bookings'], auth: 'userOrApiKey', body: createBookingInput, idempotent: true });
    reg.add({ method: 'get', path: '/bookings/:id', summary: 'Get booking', tags: ['Bookings'], auth: 'user', params: z.object({ id: z.uuid() }) });
    const doc = reg.document({ title: 'Test', version: '1', serverUrl: 'http://localhost/api/v1' }) as { paths: Record<string, Record<string, { parameters: { name: string }[] }>> };
    expect(Object.keys(doc.paths)).toEqual(['/bookings', '/bookings/{id}']);
    expect(doc.paths['/bookings']!.post!.parameters.map((p) => p.name)).toContain('Idempotency-Key');
    expect(doc.paths['/bookings/{id}']!.get!.parameters[0]!.name).toBe('id');
  });
});
