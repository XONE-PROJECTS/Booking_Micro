'use client';

import { useEffect, useState } from 'react';
import { adminGetList, adminPost, adminDelete } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { DataTable, PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function IntegrationsPage() {
  const { token } = useAdminAuth();
  const [keys, setKeys] = useState<Record<string, unknown>[]>([]);
  const [hooks, setHooks] = useState<Record<string, unknown>[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, unknown>[]>([]);
  const [hookUrl, setHookUrl] = useState('');
  const [keyName, setKeyName] = useState('Integration');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    void adminGetList('/integrations/api-keys?pageSize=50', token).then(setKeys);
    void adminGetList('/integrations/webhooks?pageSize=50', token).then(setHooks);
    void adminGetList('/integrations/webhooks/deliveries?pageSize=30', token).then(setDeliveries).catch(() => setDeliveries([]));
  };

  useEffect(() => load(), [token]);

  return (
    <div>
      <PageHeader title="Integrations" />
      <h2>API keys</h2>
      <Field label="Name" id="kn"><Input id="kn" value={keyName} onChange={(e) => setKeyName(e.target.value)} /></Field>
      <Button onClick={() => token && void adminPost('/integrations/api-keys', { name: keyName }, token).then((r) => { setCreatedSecret(String((r as { key?: string }).key ?? (r as { signingSecret?: string }).signingSecret ?? 'created')); load(); })}>Create key</Button>
      {createdSecret ? <p>Copy now: <code>{createdSecret}</code></p> : null}
      <DataTable columns={[{ key: 'name', label: 'Name' }, { key: 'prefix', label: 'Prefix' }, { key: 'createdAt', label: 'Created' }]} rows={keys} />
      <h2>Webhooks</h2>
      <Field label="URL" id="url"><Input id="url" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} /></Field>
      <Button onClick={() => token && void adminPost('/integrations/webhooks', { url: hookUrl, events: ['booking.created'], status: 'active' }, token).then(() => { setHookUrl(''); load(); })}>Add webhook</Button>
      <DataTable
        columns={[
          { key: 'url', label: 'URL' },
          { key: 'status', label: 'Status' },
          {
            key: 'test',
            label: 'Test',
            render: (r) => <Button onClick={() => token && void adminPost(`/integrations/webhooks/${r.id}/test`, {}, token)}>Test</Button>,
          },
          {
            key: 'del',
            label: '',
            render: (r) => <Button onClick={() => token && void adminDelete(`/integrations/webhooks/${r.id}`, token).then(load)}>Remove</Button>,
          },
        ]}
        rows={hooks}
      />
      <h2>Deliveries</h2>
      <DataTable
        columns={[
          { key: 'eventType', label: 'Event' },
          { key: 'status', label: 'Status' },
          {
            key: 'replay',
            label: 'Replay',
            render: (r) => <Button onClick={() => token && void adminPost(`/integrations/webhooks/deliveries/${r.id}/replay`, {}, token)}>Replay</Button>,
          },
        ]}
        rows={deliveries}
      />
    </div>
  );
}