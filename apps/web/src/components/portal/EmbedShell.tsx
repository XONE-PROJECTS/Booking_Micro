import type { ReactNode } from 'react';
import type { PortalProfile } from '@/lib/portal-api';

export function EmbedShell({ profile, children }: { profile: PortalProfile; children: ReactNode }) {
  const b = profile.branding;
  const style = {
    ['--accent' as string]: b?.primaryColor ?? '#3b82f6',
    ['--portal-bg' as string]: b?.backgroundColor ?? '#fff',
    ['--portal-fg' as string]: b?.textColor ?? '#111',
    fontFamily: b?.fontFamily,
  };
  const name = profile.profile?.displayName ?? profile.name;

  return (
    <div className="embed-root" style={style}>
      <header className="embed-header">
        {b?.logoUrl ? <img src={b.logoUrl} alt="" width={120} height={36} /> : <strong>{name}</strong>}
      </header>
      <main className="embed-main">{children}</main>
    </div>
  );
}