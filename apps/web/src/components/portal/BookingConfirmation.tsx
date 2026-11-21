'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiPost } from '@/lib/api';

type BookingView = {
  reference: string;
  status: string;
  localStart?: string;
  service?: { name?: string };
  pricing?: { total?: string; currency?: string };
};

export function BookingConfirmation({
  businessSlug,
  reference,
  token,
  embed,
}: {
  businessSlug: string;
  reference: string | null;
  token: string | null;
  embed?: boolean;
}) {
  const t = useTranslations('portal');
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reference || !token) return;
    void apiPost<BookingView>(`/public/${businessSlug}/bookings/lookup`, { reference, token })
      .then(setBooking)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load booking'));
  }, [businessSlug, reference, token]);

  const ref = booking?.reference ?? reference;

  return (
    <section className={`card${embed ? ' embed-confirmation' : ''}`} role="status">
      <h1>Booking confirmed</h1>
      {ref ? (
        <p>
          {t('reference')}: <strong>{ref}</strong>
        </p>
      ) : null}
      {booking ? (
        <>
          <p>
            {booking.service?.name ?? 'Service'} — {booking.status}
            {booking.localStart ? ` · ${booking.localStart}` : ''}
          </p>
          {booking.pricing?.total ? (
            <p>
              {booking.pricing.currency ?? ''} {booking.pricing.total}
            </p>
          ) : null}
        </>
      ) : null}
      {token ? (
        <p>
          {t('saveToken')}: <code>{token}</code>
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {embed ? <p className="portal-muted">You can close this window or continue in the full portal.</p> : null}
      <p>
        <Link href={`/${businessSlug}/lookup`}>{t('lookup')}</Link>
        {token && ref ? (
          <>
            {' · '}
            <Link href={`/${businessSlug}/account/bookings/guest?reference=${ref}&token=${token}`}>Manage booking</Link>
          </>
        ) : null}
      </p>
    </section>
  );
}
