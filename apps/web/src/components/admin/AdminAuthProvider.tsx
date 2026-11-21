'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearAdminToken, getAdminToken, setAdminToken } from '@/lib/auth';
import type { AuthSession } from '@/lib/admin-api';

const SESSION_KEY = 'ub_admin_session';

type Ctx = {
  session: AuthSession | null;
  token: string | null;
  login: (s: AuthSession) => void;
  logout: () => void;
};

const AdminAuthContext = createContext<Ctx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getAdminToken();
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
    if (token && raw) {
      try {
        setSession(JSON.parse(raw) as AuthSession);
      } catch {
        clearAdminToken();
      }
    }
    setReady(true);
  }, []);

  const login = useCallback((s: AuthSession) => {
    setAdminToken(s.accessToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    router.push('/admin/login');
  }, [router]);

  const value = useMemo(
    () => ({ session, token: session?.accessToken ?? getAdminToken(), login, logout }),
    [session, login, logout],
  );

  const isLogin = pathname === '/admin/login';

  useEffect(() => {
    if (!ready) return;
    if (!isLogin && !value.token) router.replace('/admin/login');
    if (isLogin && value.token) router.replace('/admin');
  }, [ready, isLogin, value.token, router]);

  if (!ready && !isLogin) return <p className="shell">Loading…</p>;

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth outside provider');
  return ctx;
}