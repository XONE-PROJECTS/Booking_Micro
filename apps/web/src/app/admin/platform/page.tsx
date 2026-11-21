'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPatch, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function PlatformPage() {
  const { token, session } = useAdminAuth();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({ slug: '', name: '', ownerEmail: '', ownerName: 'Owner', ownerPassword: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    token &&
    void adminGetList('/platform/tenants?pageSize=100', token)
      .then(setRows)
      .catch((e) => setMsg(String(e)));

  useEffect(() => {
    if (session?.user?.isPlatformAdmin) load();
  }, [token, session]);

  if (!session?.user?.isPlatformAdmin) {
    return <p>Platform admin access required.</p>;
  }

  return (
    <div>
      <PageHeader title="Platform tenants" />
      <Field label="Slug" id="slug">
        <Input id="slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
      </Field>
      <Field label="Name" id="name">
        <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Owner email" id="own">
        <Input id="own" value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} />
      </Field>
      <Field label="Owner password (optional)" id="opw">
        <Input
          id="opw"
          type="password"
          value={form.ownerPassword}
          onChange={(e) => setForm((f) => ({ ...f, ownerPassword: e.target.value }))}
        />
      </Field>
      <Button
        onClick={() =>
          token &&
          void adminPost(
            '/platform/tenants',
            {
              slug: form.slug,
              name: form.name,
              owner: {
                email: form.ownerEmail,
                name: form.ownerName,
                ...(form.ownerPassword ? { password: form.ownerPassword } : {}),
              },
            },
            token,
          ).then(load)
        }
      >
        Create tenant
      </Button>
      <Button
        onClick={() => token && rows[0] && void adminPatch(`/platform/tenants/${rows[0].id}`, { status: 'suspended' }, token).then(load)}
      >
        Suspend first
      </Button>
      {msg ? <p>{msg}</p> : null}
      <DataTable
        columns={[
          { key: 'slug', label: 'Slug' },
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ]}
        rows={rows}
      />
    </div>
  );
}
