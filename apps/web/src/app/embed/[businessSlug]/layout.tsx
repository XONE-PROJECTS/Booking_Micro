import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import type { PortalProfile } from '@/lib/portal-api';
import { EmbedShell } from '@/components/portal/EmbedShell';

type Props = { children: ReactNode; params: Promise<{ businessSlug: string }> };

export default async function EmbedLayout({ children, params }: Props) {
  const { businessSlug } = await params;
  let profile: PortalProfile = { slug: businessSlug, name: businessSlug, currency: 'PHP', timezone: 'Asia/Manila', locale: 'en-PH', guestBookingEnabled: true };
  try {
    profile = await apiGet<PortalProfile>(`/public/${businessSlug}`);
  } catch {
    /* offline */
  }
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={profile.locale || 'en-PH'}>
      <EmbedShell profile={profile}>{children}</EmbedShell>
    </NextIntlClientProvider>
  );
}