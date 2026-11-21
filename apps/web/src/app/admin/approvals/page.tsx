'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGetList } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button } from '@/components/portal/ui';

type Row = Record<string, unknown> & { id: string; reference?: string; status?: string };

export default function ApprovalsPage() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    void adminGetList<Row>('/bookings?status=pending&pageSize=100', token).then(setRows);
  }, [token]);

  useEffect(() => load(), [load]);

  return (
    <div>
      <PageHeader title="Pending approvals" actions={<Button onClick={load}>Refresh</Button>} />
      <p className="portal-muted">Bookings awaiting staff approval. Open a row to approve or reject.</p>
      <DataTable
        columns={[
          { key: 'reference', label: 'Reference' },
          { key: 'status', label: 'Status' },
          { key: 'startAt', label: 'Start', render: (r) => String(r.startAt ?? '').slice(0, 16) },
          { key: 'total', label: 'Total' },
        ]}
        rows={rows}
        onRowClick={(r) => {
          setSelectedId(String(r.id));
          setDrawerOpen(true);
        }}
      />
      <BookingDrawer bookingId={selectedId} open={drawerOpen} onClose={() => setDrawerOpen(false)} onUpdated={load} />
    </div>
  );
}