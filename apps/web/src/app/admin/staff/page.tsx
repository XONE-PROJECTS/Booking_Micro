'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function StaffPage() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({ email: '', name: '', password: 'ChangeMe123!' });

  const load = () => {
    if (!token) return;
    void adminGetList('/staff?pageSize=100', token).then(setRows);
  };

  useEffect(() => {
    load();
  }, [token]);

  async function invite() {
    if (!token) return;
    await adminPost('/staff', { ...form, roleKeys: ['staff'] }, token);
    setForm({ email: '', name: '', password: 'ChangeMe123!' });
    load();
  }

  return (
    <div>
      <PageHeader title="Staff" />
      <div className="filter-bar">
        <Field label="Name" id="nm"><Input id="nm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Email" id="em"><Input id="em" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        <Button onClick={() => void invite()}>Add staff</Button>
      </div>
      <DataTable columns={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Status' }]} rows={rows} />
    </div>
  );
}