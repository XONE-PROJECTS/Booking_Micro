'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { getCustomerToken } from '@/lib/portal-api';
import { Alert, Button, Input } from '@/components/portal/ui';

type BookingView = { id: string; reference: string; status: string; localStart?: string };

export default function BookingDetailPage() {
  const { businessSlug, id } = useParams<{ businessSlug: string; id: string }>();
  const t = useTranslations('portal');
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [newDate, setNewDate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'guest' | 'ready'>('loading');

  useEffect(() => {
    const token = getCustomerToken(businessSlug);
    if (!token) {
      setAuthState('guest');
      return;
    }
    setAuthState('loading');
    void apiGet<BookingView>(`/bookings/${id}`, token)
      .then((b) => {
        setBooking(b);
        setAuthState('ready');
      })
      .catch(() => setAuthState('guest'));
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
      const updated = await apiPost<BookingView>(
        `/bookings/${id}/reschedule`,
        { startDate: newDate, reason: 'Customer request' },
        undefined,
        token,
      );
      setBooking(updated);
      setMsg('Rescheduled.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (authState === 'guest') {
    return (
      <div className="card">
        <p>Sign in to view this booking, or use guest lookup with your reference and access token.</p>
        <p>
          <Link href={`/${businessSlug}/account`}>{t('account')}</Link>
          {' · '}
          <Link href={`/${businessSlug}/lookup`}>{t('lookup')}</Link>
        </p>
      </div>
    );
  }

  if (authState === 'loading' || !booking) return <p>{t('loading')}</p>;

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
