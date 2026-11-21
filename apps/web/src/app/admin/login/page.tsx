'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminLogin } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { Alert, Button, Field, Input } from '@/components/portal/ui';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAdminAuth();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="shell">
      <h1>Staff sign in</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void adminLogin({ email, password, tenantSlug: tenantSlug || undefined })
            .then((s) => {
              login(s);
              router.push('/admin');
            })
            .catch((err) => setError(String(err)));
        }}
      >
        <Field label="Business slug" id="slug">
          <Input id="slug" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} placeholder="demo" />
        </Field>
        <Field label="Email" id="email">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="password">
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit">Sign in</Button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
    </main>
  );
}