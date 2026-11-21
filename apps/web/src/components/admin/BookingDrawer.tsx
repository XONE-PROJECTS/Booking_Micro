'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from './AdminAuthProvider';
import { Button } from '../portal/ui';
import { SideDrawer } from './ui';

type BookingView = Record<string, unknown> & {
  id: string;
  reference: string;
  status: string;
  availableActions?: string[];
  customer?: { firstName?: string; email?: string };
  service?: { name?: string };
  total?: string;
  localStart?: string;
};

export function BookingDrawer({
  bookingId,
  open,
  onClose,
  onUpdated,
}: {
  bookingId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const { token } = useAdminAuth();
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [amount, setAmount] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bookingId || !token) return;
    void adminGet<BookingView>(`/bookings/${bookingId}`, token).then(setBooking);
  }, [open, bookingId, token]);

  async function transition(action: string) {
    if (!bookingId || !token) return;
    const updated = await adminPost<BookingView>(`/bookings/${bookingId}/transitions/${action}`, {}, token);
    setBooking(updated);
    setMsg(`Applied ${action}`);
    onUpdated?.();
  }

  async function reschedule() {
    if (!bookingId || !token || !rescheduleDate) return;
    const updated = await adminPost<BookingView>(`/bookings/${bookingId}/reschedule`, { startDate: rescheduleDate }, token);
    setBooking(updated);
    setMsg('Rescheduled');
    onUpdated?.();
  }

  async function recordPayment() {
    if (!bookingId || !token || !amount) return;
    await adminPost(`/bookings/${bookingId}/payments/record`, { amount, method: 'cash', provider: 'manual' }, token);
    setMsg('Payment recorded');
    const b = await adminGet<BookingView>(`/bookings/${bookingId}`, token);
    setBooking(b);
    onUpdated?.();
  }

  return (
    <SideDrawer open={open} onClose={onClose} title={booking?.reference ?? 'Booking'}>
      {!booking ? (
        <p>Loading…</p>
      ) : (
        <>
          <p>
            <strong>{booking.status}</strong> · {booking.service?.name} · {booking.localStart}
          </p>
          <p>
            {booking.customer?.firstName} {booking.customer?.email}
          </p>
          <p>Total: {booking.total}</p>
          <div className="admin-actions">
            {(booking.availableActions ?? []).slice(0, 8).map((a) => (
              <Button key={a} onClick={() => void transition(a)}>
                {a}
              </Button>
            ))}
          </div>
          <h3>Reschedule</h3>
          <input className="portal-input" type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
          <Button onClick={() => void reschedule()}>Apply new date</Button>
          <h3>Record payment</h3>
          <input className="portal-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
          <Button onClick={() => void recordPayment()}>Record</Button>
          {msg ? <p role="status">{msg}</p> : null}
        </>
      )}
    </SideDrawer>
  );
}