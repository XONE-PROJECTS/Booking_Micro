'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/portal/ui';

export default function LookupPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const router = useRouter();
  const t = useTranslations('portal');
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <h1>{t('lookup')}</h1>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void apiPost<{ id: string; reference: string }>(`/public/${businessSlug}/bookings/lookup`, {
            reference,
            email: email || undefined,
            token: token || undefined,
          })
            .then((b) => {
              if (token) router.push(`/${businessSlug}/account/bookings/guest?reference=${b.reference}&token=${token}&id=${b.id}`);
              else router.push(`/${businessSlug}/account/bookings/${b.id}`);
            })
            .catch((err) => setError(String(err)));
        }}
      >
        <Field label={t('reference')} id="ref">
          <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} required />
        </Field>
        <Field label="Email" id="em">
          <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Access code (optional)" id="tok">
          <Input id="tok" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        <button type="submit" className="portal-btn">
          Search
        </button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
    </>
  );
}