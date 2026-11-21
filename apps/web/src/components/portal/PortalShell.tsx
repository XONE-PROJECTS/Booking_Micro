import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PortalProfile } from '@/lib/portal-api';

export function PortalShell({ profile, children }: { profile: PortalProfile; children: ReactNode }) {
  const b = profile.branding;
  const style = {
    ['--accent' as string]: b?.primaryColor ?? '#3b82f6',
    ['--portal-bg' as string]: b?.backgroundColor ?? 'var(--bg)',
    ['--portal-fg' as string]: b?.textColor ?? 'var(--fg)',
    fontFamily: b?.fontFamily,
    borderRadius: b?.borderRadius,
  };

  const name = profile.profile?.displayName ?? profile.name;

  return (
    <div className="portal-root" style={style}>
      <a href="#portal-main" className="skip-link">
        Skip to content
      </a>
      <header className="portal-header">
        <div className="portal-header-inner">
          {b?.logoUrl ? <img src={b.logoUrl} alt="" width={140} height={40} /> : <strong>{name}</strong>}
          <nav aria-label="Portal">
            <Link href={`/${profile.slug}`}>Services</Link>
            <Link href={`/${profile.slug}/lookup`}>Find booking</Link>
            <Link href={`/${profile.slug}/account`}>Account</Link>
          </nav>
        </div>
        {b?.portal?.headerHtml ? <div className="portal-html" dangerouslySetInnerHTML={{ __html: b.portal.headerHtml }} /> : null}
      </header>
      <main id="portal-main" className="shell">
        {children}
      </main>
      <footer className="portal-footer">
        {b?.portal?.footerHtml ? <div className="portal-html" dangerouslySetInnerHTML={{ __html: b.portal.footerHtml }} /> : <p>© {name}</p>}
      </footer>
    </div>
  );
}