'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function CatalogPage() {
  const { token } = useAdminAuth();
  const [services, setServices] = useState<Record<string, unknown>[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    void adminGetList('/services?pageSize=100', token).then(setServices);
  };

  useEffect(() => {
    load();
  }, [token]);

  async function createService() {
    if (!token || !name) return;
    await adminPost('/services', { name, basePrice: '0', status: 'draft' }, token);
    setName('');
    setMsg('Service created');
    load();
  }

  async function publish(id: string) {
    if (!token) return;
    await adminPost(`/services/${id}/publish`, {}, token);
    load();
  }

  async function archive(id: string) {
    if (!token) return;
    await adminPost(`/services/${id}/archive`, {}, token);
    load();
  }

  return (
    <div>
      <PageHeader title="Catalog" />
      <div className="filter-bar">
        <Field label="New service name" id="n">
          <Input id="n" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button onClick={() => void createService()}>Add service</Button>
      </div>
      {msg ? <p>{msg}</p> : null}
      <DataTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
          { key: 'basePrice', label: 'Base' },
          {
            key: 'actions',
            label: 'Actions',
            render: (r) => (
              <>
                <Button onClick={() => void publish(String(r.id))}>Publish</Button>
                <Button onClick={() => void archive(String(r.id))}>Archive</Button>
              </>
            ),
          },
        ]}
        rows={services}
      />
    </div>
  );
}