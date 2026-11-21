'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { getCustomerToken } from '@/lib/portal-api';

type BookingRow = { id: string; reference: string; status: string; localStart?: string };

export default function MyBookingsPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const t = useTranslations('portal');
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    const token = getCustomerToken(businessSlug);
    if (!token) {
      setSignedIn(false);
      return;
    }
    setSignedIn(true);
    void apiGet<BookingRow[]>(`/bookings?pageSize=20`, token)
      .then(setRows)
      .catch(() => setRows([]));
  }, [businessSlug]);

  if (!signedIn) {
    return (
      <div className="card">
        <h1>My bookings</h1>
        <p>Sign in to see bookings linked to your account.</p>
        <p>
          <Link href={`/${businessSlug}/account`}>{t('account')}</Link>
          {' · '}
          <Link href={`/${businessSlug}/lookup`}>{t('lookup')}</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>My bookings</h1>
      <ul className="card">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/${businessSlug}/account/bookings/${b.id}`}>
              {b.reference} — {b.status} {b.localStart ? `(${b.localStart})` : ''}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
