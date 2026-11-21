'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminGet, adminGetList } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { PageHeader } from '@/components/admin/ui';

export default function AdminDashboard() {
  const { token } = useAdminAuth();
  const [revenue, setRevenue] = useState<{ bookings?: number; gross?: string } | null>(null);
  const [pending, setPending] = useState<unknown[]>([]);

  useEffect(() => {
    if (!token) return;
    void adminGet<{ bookings: number; gross: string }>('/reports/revenue', token).then(setRevenue);
    void adminGetList('/bookings?status=pending&pageSize=5', token).then(setPending).catch(() => setPending([]));
  }, [token]);

  return (
    <div>
      <PageHeader title="Dashboard" />
      <div className="admin-widgets">
        <div className="card">
          <h2>Revenue</h2>
          <p>Bookings: {revenue?.bookings ?? '—'}</p>
          <p>Gross: {revenue?.gross ?? '—'}</p>
        </div>
        <div className="card">
          <h2>Pending</h2>
          <p>{pending.length} recent pending bookings</p>
          <Link href="/admin/approvals">Review approvals →</Link>
          <Link href="/admin/bookings">Open reservation desk →</Link>
        </div>
      </div>
    </div>
  );
}