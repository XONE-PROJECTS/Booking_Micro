'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminGetList, adminPatch } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader, SideDrawer, StatusBadge } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function CustomersPage() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [bookings, setBookings] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', marketingConsent: 'false' });
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    void adminGetList('/customers?pageSize=100', token).then(setRows);
  };

  useEffect(() => {
    load();
  }, [token]);

  async function openCustomer(id: string) {
    if (!token) return;
    const c = await adminGet<Record<string, unknown>>(`/customers/${id}`, token);
    setDetail(c);
    setForm({
      firstName: String(c.firstName ?? ''),
      lastName: String(c.lastName ?? ''),
      email: String(c.email ?? ''),
      phone: String(c.phone ?? ''),
      marketingConsent: c.marketingConsent ? 'true' : 'false',
    });
    const list = await adminGetList<Record<string, unknown>>(`/bookings?customerId=${id}&pageSize=20`, token);
    setBookings(list);
    setOpen(true);
  }

  async function save() {
    if (!token || !detail?.id) return;
    setMsg(null);
    try {
      await adminPatch(`/customers/${String(detail.id)}`, {
        firstName: form.firstName,
        lastName: form.lastName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        marketingConsent: form.marketingConsent === 'true',
      }, token);
      setMsg('Customer updated');
      load();
      void openCustomer(String(detail.id));
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <PageHeader title="Customers" />
      <DataTable
        columns={[
          { key: 'firstName', label: 'First' },
          { key: 'lastName', label: 'Last' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
        ]}
        rows={rows}
        onRowClick={(r) => void openCustomer(String(r.id))}
      />
      <SideDrawer open={open} onClose={() => setOpen(false)} title={String(detail?.email ?? detail?.firstName ?? 'Customer')}>
        <Field label="First name" id="c-fn">
          <Input id="c-fn" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
        </Field>
        <Field label="Last name" id="c-ln">
          <Input id="c-ln" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
        </Field>
        <Field label="Email" id="c-em">
          <Input id="c-em" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Phone" id="c-ph">
          <Input id="c-ph" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <label className="portal-field">
          <input type="checkbox" checked={form.marketingConsent === 'true'} onChange={(e) => setForm((f) => ({ ...f, marketingConsent: e.target.checked ? 'true' : 'false' }))} /> Marketing consent
        </label>
        {detail?.locale ? <p className="portal-muted">Locale: {String(detail.locale)}</p> : null}
        <div className="admin-actions">
          <Button onClick={() => void save()}>Save</Button>
        </div>
        {msg ? <p role="status">{msg}</p> : null}
        <h3>Recent bookings</h3>
        <ul>
          {bookings.map((b) => (
            <li key={String(b.id)}>
              <strong>{String(b.reference)}</strong> <StatusBadge status={String(b.status)} /> — {String(b.startAt ?? '')}
            </li>
          ))}
        </ul>
        {bookings.length === 0 ? <p className="portal-muted">No bookings yet.</p> : null}
      </SideDrawer>
    </div>
  );
}