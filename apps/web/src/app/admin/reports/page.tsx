'use client';

import { useState } from 'react';
import { adminFetchReport, downloadCsv } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

const kinds = ['bookings', 'revenue', 'services', 'occupancy', 'utilization', 'cancellations', 'customers', 'payments', 'trends'] as const;

export default function ReportsPage() {
  const { token } = useAdminAuth();
  const [kind, setKind] = useState<(typeof kinds)[number]>('bookings');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<unknown>(null);

  async function load(fmt: 'json' | 'csv') {
    if (!token) return;
    const q = new URLSearchParams({ format: fmt });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const res = await adminFetchReport(`/reports/${kind}?${q}`, token);
    if (fmt === 'csv' && res && typeof res === 'object' && 'csv' in res) {
      const csv = String((res as { csv: string }).csv);
      downloadCsv(`${kind}.csv`, csv);
      return;
    }
    if (fmt === 'csv' && typeof res === 'string') {
      downloadCsv(`${kind}.csv`, res);
      return;
    }
    setData(res);
  }

  const rows = Array.isArray((data as { rows?: unknown[] })?.rows)
    ? (data as { rows: Record<string, unknown>[] }).rows
    : Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : data && typeof data === 'object'
        ? [data as Record<string, unknown>]
        : [];
  const cols = Object.keys(rows[0] ?? { value: 'value' }).map((k) => ({ key: k, label: k }));

  return (
    <div>
      <PageHeader title="Reports" />
      <div className="admin-actions">
        {kinds.map((k) => (
          <button key={k} type="button" className={kind === k ? 'portal-btn' : 'link-btn'} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <Field label="From" id="f">
        <Input id="f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To" id="t">
        <Input id="t" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Button onClick={() => void load('json')}>Run</Button>
      <Button onClick={() => void load('csv')}>Download CSV</Button>
      <DataTable columns={cols} rows={rows} />
    </div>
  );
}
