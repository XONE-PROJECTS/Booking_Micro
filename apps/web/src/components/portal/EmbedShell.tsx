import type { ReactNode } from 'react';
import type { PortalProfile } from '@/lib/portal-api';

const WARM = {
  accent: '#c4622d',
  bg: '#f6f1e8',
  fg: '#2a2118',
} as const;

export function EmbedShell({ profile, children }: { profile: PortalProfile; children: ReactNode }) {
  const b = profile.branding;
  const style = {
    ['--accent' as string]: b?.primaryColor ?? WARM.accent,
    ['--portal-bg' as string]: b?.backgroundColor ?? WARM.bg,
    ['--portal-fg' as string]: b?.textColor ?? WARM.fg,
    fontFamily: b?.fontFamily,
  };
  const name = profile.profile?.displayName ?? profile.name;

  return (
    <div className="embed-root" style={style}>
      <header className="embed-header">
        {b?.logoUrl ? <img src={b.logoUrl} alt="" width={120} height={36} /> : <strong className="portal-brand">{name}</strong>}
      </header>
      <main className="embed-main">{children}</main>
    </div>
  );
}
