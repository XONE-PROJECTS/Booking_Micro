'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPatch, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function CatalogPage() {
  const { token } = useAdminAuth();
  const [services, setServices] = useState<Record<string, unknown>[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');

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

  function startEdit(row: Record<string, unknown>) {
    setEditId(String(row.id));
    setEditName(String(row.name ?? ''));
    setEditPrice(String(row.basePrice ?? '0'));
  }

  async function saveEdit() {
    if (!token || !editId) return;
    await adminPatch(`/services/${editId}`, { name: editName, basePrice: editPrice }, token);
    setEditId(null);
    setMsg('Service updated');
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
      {editId ? (
        <div className="card filter-bar">
          <Field label="Name" id="en">
            <Input id="en" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label="Base price" id="ep">
            <Input id="ep" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
          </Field>
          <Button onClick={() => void saveEdit()}>Save</Button>
          <Button onClick={() => setEditId(null)}>Cancel</Button>
        </div>
      ) : null}
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
                <Button onClick={() => startEdit(r)}>Edit</Button>
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
