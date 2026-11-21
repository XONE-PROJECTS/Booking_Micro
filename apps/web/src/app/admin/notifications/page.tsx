'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPatch, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader, SideDrawer } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

const CHANNELS = ['email', 'sms', 'in_app'] as const;

const defaults = {
  key: 'booking.confirmed',
  channel: 'email' as (typeof CHANNELS)[number],
  locale: 'en-PH',
  subject: 'Booking confirmed',
  body: 'Hello {{customer.firstName}}, your booking {{booking.reference}} is confirmed for {{booking.startAt}}.',
  active: true,
};

export default function NotificationsPage() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState(defaults);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    void adminGetList('/notification-templates?pageSize=100', token).then(setRows);
  };

  useEffect(() => {
    load();
  }, [token]);

  async function create() {
    if (!token) return;
    setMsg(null);
    try {
      await adminPost('/notification-templates', form, token);
      setForm(defaults);
      setMsg('Template created');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function saveEdit() {
    if (!token || !edit?.id) return;
    try {
      await adminPatch(`/notification-templates/${String(edit.id)}`, form, token);
      setEdit(null);
      setMsg('Template updated');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  function openEdit(row: Record<string, unknown>) {
    setEdit(row);
    setForm({
      key: String(row.key),
      channel: String(row.channel) as (typeof CHANNELS)[number],
      locale: String(row.locale ?? 'en-PH'),
      subject: String(row.subject ?? ''),
      body: String(row.body ?? ''),
      active: row.active !== false,
    });
  }

  const formFields = (
    <>
      <Field label="Event key" id="nt-key">
        <Input id="nt-key" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} />
      </Field>
      <Field label="Channel" id="nt-ch">
        <select id="nt-ch" className="portal-input" value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as (typeof CHANNELS)[number] }))}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Locale" id="nt-loc">
        <Input id="nt-loc" value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))} />
      </Field>
      <Field label="Subject" id="nt-sub">
        <Input id="nt-sub" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
      </Field>
      <Field label="Body" id="nt-body">
        <textarea id="nt-body" className="portal-input json-editor" rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
      </Field>
      <label className="portal-field">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active
      </label>
    </>
  );

  return (
    <div>
      <PageHeader title="Notification templates" />
      <div className="card filter-bar">
        {formFields}
        <Button onClick={() => void create()}>Create template</Button>
      </div>
      {msg ? <p role="status">{msg}</p> : null}
      <DataTable
        columns={[
          { key: 'key', label: 'Key' },
          { key: 'channel', label: 'Channel' },
          { key: 'subject', label: 'Subject' },
          { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
          {
            key: 'actions',
            label: '',
            render: (r) => (
              <button type="button" className="link-btn" onClick={() => openEdit(r)}>
                Edit
              </button>
            ),
          },
        ]}
        rows={rows}
        onRowClick={openEdit}
      />
      <SideDrawer open={!!edit} onClose={() => setEdit(null)} title="Edit template">
        {formFields}
        <div className="admin-actions">
          <Button onClick={() => void saveEdit()}>Save</Button>
        </div>
      </SideDrawer>
    </div>
  );
}