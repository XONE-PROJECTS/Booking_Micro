'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { clearCustomerToken, getCustomerToken, setCustomerToken } from '@/lib/portal-api';
import { Alert, Button, Field, Input } from '@/components/portal/ui';

export default function AccountPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const token = typeof window !== 'undefined' ? getCustomerToken(businessSlug) : null;

  async function submit() {
    setError(null);
    try {
      const path = mode === 'login' ? 'login' : 'register';
      const body = mode === 'login' ? { email, password } : { email, password, firstName, lastName: '' };
      const session = await apiPost<{ accessToken: string }>(`/public/${businessSlug}/auth/${path}`, body);
      setCustomerToken(businessSlug, session.accessToken);
      router.push(`/${businessSlug}/account/bookings`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (token) {
    return (
      <div className="card">
        <p>Signed in.</p>
        <Link href={`/${businessSlug}/account/bookings`}>View my bookings</Link>
        <Button
          onClick={() => {
            clearCustomerToken(businessSlug);
            router.refresh();
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      {mode === 'register' ? (
        <Field label="First name" id="fn">
          <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Email" id="em">
        <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" id="pw">
        <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button onClick={() => void submit()}>{mode === 'login' ? 'Sign in' : 'Register'}</Button>
      <Button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account?' : 'Have an account?'}</Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}