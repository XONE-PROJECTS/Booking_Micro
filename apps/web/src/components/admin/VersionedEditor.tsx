'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminGetList, adminPatch, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from './AdminAuthProvider';
import { DataTable, PageHeader } from './ui';
import { Button, Input } from '../portal/ui';

type Row = { id: string; name: string; version: number; status: string };

export function VersionedEditor({
  title,
  basePath,
  schemaKey,
  defaultBody,
}: {
  title: string;
  basePath: string;
  schemaKey: 'schema' | 'definition' | 'policy';
  defaultBody: Record<string, unknown>;
}) {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [json, setJson] = useState('');
  const [name, setName] = useState('New item');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    void adminGetList<Row>(basePath, token).then(setRows);
  }, [basePath, token]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!selected && !json) setJson(JSON.stringify(defaultBody, null, 2));
  }, [defaultBody, json, selected]);

  async function openRow(id: string) {
    if (!token) return;
    const one = await adminGet<Record<string, unknown>>(`${basePath}/${id}`, token).catch(() => null);
    if (!one) return;
    setSelected(one);
    setJson(JSON.stringify(one[schemaKey] ?? {}, null, 2));
    setName(String(one.name ?? ''));
  }

  async function createDraft() {
    if (!token) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json || JSON.stringify(defaultBody));
    } catch {
      setMsg('Invalid JSON');
      return;
    }
    await adminPost(basePath, { name, [schemaKey]: parsed }, token);
    setMsg('Created');
    load();
  }

  async function save() {
    if (!token || !selected?.id) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setMsg('Invalid JSON');
      return;
    }
    await adminPatch(`${basePath}/${selected.id}`, { name, [schemaKey]: parsed }, token);
    setMsg('Saved');
    load();
  }

  async function publish() {
    if (!token || !selected?.id) return;
    await adminPost(`${basePath}/${selected.id}/publish`, {}, token);
    setMsg('Published');
    load();
  }

  return (
    <div>
      <PageHeader title={title} actions={<Button onClick={() => void createDraft()}>Create draft</Button>} />
      <DataTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'version', label: 'Ver' },
          { key: 'status', label: 'Status' },
        ]}
        rows={rows as unknown as Record<string, unknown>[]}
        onRowClick={(r) => void openRow(String(r.id))}
      />
      {selected ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <textarea className="portal-input json-editor" rows={16} value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="admin-actions">
            <Button onClick={() => void save()}>Save</Button>
            <Button onClick={() => void publish()}>Publish</Button>
          </div>
        </div>
      ) : null}
      {msg ? <p role="status">{msg}</p> : null}
    </div>
  );
}
