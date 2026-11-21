'use client';

import { useEffect, useState } from 'react';
import { adminGet, adminGetList, adminPatch } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

export default function SettingsPage() {
  const { token, session } = useAdminAuth();
  const [tab, setTab] = useState<'general' | 'branding'>('general');
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [settings, setSettings] = useState({ timezone: '', currency: '' });
  const [branding, setBranding] = useState<{ primaryColor?: string; logoUrl?: string; embedAllowedOrigins?: string }>({});
  const [domains, setDomains] = useState<Record<string, unknown>[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void adminGet<{ profile?: Record<string, unknown>; settings?: Record<string, unknown>; branding?: Record<string, unknown> }>('/business', token).then((b) => {
      setProfile(b.profile ?? null);
      const s = b.settings ?? {};
      setSettings({ timezone: String(s.timezone ?? ''), currency: String(s.currency ?? '') });
      const br = b.branding ?? {};
      const portal = (br.portal as Record<string, unknown>) ?? {};
      const origins = (br.embedAllowedOrigins as string[] | undefined) ?? [];
      setBranding({
        primaryColor: String(portal.primaryColor ?? br.primaryColor ?? ''),
        logoUrl: String(br.logoUrl ?? ''),
        embedAllowedOrigins: origins.join('\n'),
      });
    });
    void adminGetList('/domains', token).then(setDomains).catch(() => setDomains([]));
  }, [token]);

  const slug = session?.tenant?.slug ?? 'demo';

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="admin-actions">
        <button type="button" className={tab === 'general' ? 'portal-btn' : 'link-btn'} onClick={() => setTab('general')}>General</button>
        <button type="button" className={tab === 'branding' ? 'portal-btn' : 'link-btn'} onClick={() => setTab('branding')}>Branding</button>
      </div>
      {tab === 'general' ? (
        <div className="card">
          <p>{String(profile?.displayName ?? profile?.name ?? '')}</p>
          <Field label="Timezone" id="tz"><Input id="tz" value={settings.timezone} onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))} /></Field>
          <Field label="Currency" id="cur"><Input id="cur" value={settings.currency} onChange={(e) => setSettings((s) => ({ ...s, currency: e.target.value }))} /></Field>
          <Button onClick={() => token && void adminPatch('/settings', settings, token).then(() => setMsg('Saved'))}>Save settings</Button>
          <h3>Domains</h3>
          <ul>{domains.map((d) => <li key={String(d.id)}>{String(d.domain)} — {String(d.status)}</li>)}</ul>
        </div>
      ) : (
        <div className="branding-grid">
          <div className="card">
            <Field label="Primary color" id="pc"><Input id="pc" value={branding.primaryColor ?? ''} onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))} /></Field>
            <Field label="Logo URL" id="logo"><Input id="logo" value={branding.logoUrl ?? ''} onChange={(e) => setBranding((b) => ({ ...b, logoUrl: e.target.value }))} /></Field>
            <Field label="Embed allowed origins (one per line)" id="emb">
              <textarea
                id="emb"
                className="portal-input"
                rows={4}
                value={branding.embedAllowedOrigins ?? ''}
                onChange={(e) => setBranding((b) => ({ ...b, embedAllowedOrigins: e.target.value }))}
              />
            </Field>
            <Button
              onClick={() =>
                token &&
                void adminPatch(
                  '/branding',
                  {
                    portal: { primaryColor: branding.primaryColor },
                    logoUrl: branding.logoUrl,
                    embedAllowedOrigins: (branding.embedAllowedOrigins ?? '')
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                  token,
                ).then(() => setMsg('Branding saved'))
              }
            >
              Save branding
            </Button>
          </div>
          <iframe title="Portal preview" className="portal-preview-frame" src={`/${slug}?preview=1`} />
        </div>
      )}
      {msg ? <p role="status">{msg}</p> : null}
    </div>
  );
}