'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminAuthProvider, useAdminAuth } from '@/components/admin/AdminAuthProvider';

const nav = [
  ['', 'Dashboard'],
  ['bookings', 'Bookings'],
  ['approvals', 'Approvals'],
  ['calendar', 'Calendar'],
  ['catalog', 'Catalog'],
  ['availability', 'Availability'],
  ['customers', 'Customers'],
  ['staff', 'Staff'],
  ['pricing', 'Pricing'],
  ['builder', 'Builder'],
  ['config/forms', 'Forms'],
  ['config/workflows', 'Workflows'],
  ['config/policies', 'Policies'],
  ['reports', 'Reports'],
  ['integrations', 'Integrations'],
  ['notifications', 'Notifications'],
  ['settings', 'Settings'],
  ['platform', 'Platform'],
] as const;

function navHref(segment: string) {
  return segment ? `/admin/${segment}` : '/admin';
}

function navActive(pathname: string, segment: string) {
  const href = navHref(segment);
  if (segment === '') return pathname === '/admin' || pathname === '/admin/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, logout } = useAdminAuth();

  if (pathname === '/admin/login') return <>{children}</>;

  return (
    <div className="admin-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="admin-nav" aria-label="Administration">
        <h1>
          <Link href="/admin">Universal Booking</Link>
        </h1>
        <p className="portal-muted">{session?.tenant?.name ?? 'Staff'}</p>
        <nav>
          <ul>
            {nav
              .filter(([segment]) => segment !== 'platform' || session?.user?.isPlatformAdmin)
              .map(([segment, label]) => {
                const href = navHref(segment);
                const active = navActive(pathname, segment);
                return (
                  <li key={segment}>
                    <Link href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                      {label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>
        <button type="button" className="portal-btn" onClick={logout}>
          Sign out
        </button>
      </aside>
      <main id="main" className="admin-main">
        {children}
      </main>
    </div>
  );
}

export function AdminChrome({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <Chrome>{children}</Chrome>
    </AdminAuthProvider>
  );
}
