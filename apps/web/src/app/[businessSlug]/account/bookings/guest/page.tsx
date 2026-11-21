'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Alert, Button, Input } from '@/components/portal/ui';

type BookingView = { id: string; reference: string; status: string };

export default function GuestBookingPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const sp = useSearchParams();
  const [booking, setBooking] = useState<BookingView | null>(null);
  const reference = sp.get('reference') ?? '';
  const token = sp.get('token') ?? '';
  const [newDate, setNewDate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const bookingId = sp.get('id');

  useEffect(() => {
    if (!token) return;
  const load = async () => {
      if (bookingId) {
        const b = await apiGet<BookingView>(`/public/${businessSlug}/bookings/${bookingId}?token=${encodeURIComponent(token)}`);
        setBooking(b);
        return;
      }
      if (reference) {
        const b = await apiPost<BookingView>(`/public/${businessSlug}/bookings/lookup`, { reference, token });
        setBooking(b);
      }
    };
    void load().catch((e) => setMsg(e instanceof Error ? e.message : 'Failed'));
  }, [businessSlug, bookingId, reference, token]);

  async function cancel(bookingId: string) {
    try {
      const updated = await apiPost<BookingView>(`/public/${businessSlug}/bookings/${bookingId}/transitions/cancel`, { token, reason: 'Guest request' });
      setBooking(updated);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function reschedule(bookingId: string) {
    if (!newDate) return;
    try {
      const updated = await apiPost<BookingView>(`/public/${businessSlug}/bookings/${bookingId}/reschedule`, { token, startDate: newDate });
      setBooking(updated);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (!booking) return <p>Provide reference and token from your confirmation email.</p>;

  return (
    <div className="card">
      <h1>{booking.reference}</h1>
      <p>{booking.status}</p>
      <Button onClick={() => void cancel(booking.id)}>Cancel</Button>
      <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New date" />
      <Button onClick={() => void reschedule(booking.id)}>Reschedule</Button>
      {msg ? <Alert>{msg}</Alert> : null}
    </div>
  );
}