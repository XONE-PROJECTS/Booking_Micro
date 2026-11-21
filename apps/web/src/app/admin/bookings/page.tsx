'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGetList, adminPost, bookingsToCsv, downloadCsv } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { DataTable, FilterBar, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

type Row = Record<string, unknown> & { id: string; reference?: string; status?: string; startAt?: string; total?: string; paymentStatus?: string; customerId?: string };

export default function AdminBookingsPage() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [newBooking, setNewBooking] = useState({ serviceId: '', startDate: '', email: '', firstName: '' });
  const [error, setError] = useState<string | null>(null);

  const qs = useCallback(() => {
    const p = new URLSearchParams({ pageSize: '50' });
    if (status) p.set('status', status);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (serviceId) p.set('serviceId', serviceId);
    return p.toString();
  }, [status, from, to, serviceId]);

  const load = useCallback(() => {
    if (!token) return;
    void adminGetList<Row>(`/bookings?${qs()}`, token).then(setRows).catch((e) => setError(String(e)));
  }, [token, qs]);

  useEffect(() => {
    load();
    if (!token) return;
    void adminGetList<{ id: string; name: string }>('/services?pageSize=100', token).then(setServices).catch(() => {});
  }, [load, token]);

  async function manualCreate() {
    if (!token) return;
    await adminPost(
      '/bookings',
      {
        serviceId: newBooking.serviceId,
        startDate: newBooking.startDate,
        quantity: 1,
        customer: { email: newBooking.email, firstName: newBooking.firstName, lastName: 'Guest' },
      },
      token,
      crypto.randomUUID(),
    );
    setCreateOpen(false);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Reservation desk"
        actions={
          <>
            <Button onClick={() => downloadCsv('bookings.csv', bookingsToCsv(rows))}>Export CSV</Button>
            <Button onClick={() => setCreateOpen(true)}>New booking</Button>
          </>
        }
      />
      <FilterBar>
        <Field label="Status" id="st">
          <Input id="st" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="pending,confirmed" />
        </Field>
        <Field label="From" id="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" id="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Service ID" id="svc">
          <Input id="svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        </Field>
        <Button onClick={load}>Apply</Button>
      </FilterBar>
      {error ? <p role="alert">{error}</p> : null}
      <DataTable
        columns={[
          { key: 'reference', label: 'Reference' },
          { key: 'status', label: 'Status' },
          { key: 'startAt', label: 'Start', render: (r) => String(r.startAt ?? '').slice(0, 16) },
          { key: 'paymentStatus', label: 'Payment' },
          { key: 'total', label: 'Total' },
        ]}
        rows={rows}
        onRowClick={(r) => {
          setSelectedId(String(r.id));
          setDrawerOpen(true);
        }}
      />
      <BookingDrawer bookingId={selectedId} open={drawerOpen} onClose={() => setDrawerOpen(false)} onUpdated={load} />
      {createOpen ? (
        <div className="card">
          <h2>Manual create</h2>
          <label>
            Service
            <select className="portal-input" value={newBooking.serviceId} onChange={(e) => setNewBooking((b) => ({ ...b, serviceId: e.target.value }))}>
              <option value="">Select…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Start date" id="sd">
            <Input id="sd" type="date" value={newBooking.startDate} onChange={(e) => setNewBooking((b) => ({ ...b, startDate: e.target.value }))} />
          </Field>
          <Field label="Email" id="em">
            <Input id="em" value={newBooking.email} onChange={(e) => setNewBooking((b) => ({ ...b, email: e.target.value }))} />
          </Field>
          <Field label="First name" id="fn">
            <Input id="fn" value={newBooking.firstName} onChange={(e) => setNewBooking((b) => ({ ...b, firstName: e.target.value }))} />
          </Field>
          <Button onClick={() => void manualCreate()}>Create</Button>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
        </div>
      ) : null}
    </div>
  );
}