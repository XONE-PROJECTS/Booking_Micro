'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { getCustomerToken } from '@/lib/portal-api';
import { Alert, Button, Input } from '@/components/portal/ui';

type BookingView = { id: string; reference: string; status: string; localStart?: string };

export default function BookingDetailPage() {
  const { businessSlug, id } = useParams<{ businessSlug: string; id: string }>();
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [newDate, setNewDate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const token = getCustomerToken(businessSlug);
    if (!token) return;
    void apiGet<BookingView>(`/bookings/${id}`, token).then(setBooking);
  }, [businessSlug, id]);

  async function cancel() {
    const token = getCustomerToken(businessSlug);
    if (!token) return;
    try {
      const updated = await apiPost<BookingView>(`/bookings/${id}/transitions/cancel`, { reason: 'Customer request' }, undefined, token);
      setBooking(updated);
      setMsg('Cancelled.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function reschedule() {
    const token = getCustomerToken(businessSlug);
    if (!token || !newDate) return;
    try {
      const updated = await apiPost<BookingView>(`/bookings/${id}/reschedule`, { startDate: newDate, reason: 'Customer request' }, undefined, token);
      setBooking(updated);
      setMsg('Rescheduled.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (!booking) return <p>Loading or sign in required.</p>;

  return (
    <div className="card">
      <h1>{booking.reference}</h1>
      <p>{booking.status}</p>
      <Button onClick={() => void cancel()}>Cancel</Button>
      <div style={{ marginTop: 16 }}>
        <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New date" />
        <Button onClick={() => void reschedule()}>Reschedule</Button>
      </div>
      {msg ? <Alert>{msg}</Alert> : null}
    </div>
  );
}