'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { getCustomerToken } from '@/lib/portal-api';

type BookingRow = { id: string; reference: string; status: string; localStart?: string };

export default function MyBookingsPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const [rows, setRows] = useState<BookingRow[]>([]);

  useEffect(() => {
    const token = getCustomerToken(businessSlug);
    if (!token) return;
    void apiGet<BookingRow[]>(`/bookings?pageSize=20`, token).then(setRows).catch(() => setRows([]));
  }, [businessSlug]);

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