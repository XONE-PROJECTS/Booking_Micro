import { BookWizard } from '@/components/portal/BookWizard';
import { apiGet } from '@/lib/api';
import type { PortalProfile } from '@/lib/portal-api';

type Props = { params: Promise<{ businessSlug: string; serviceSlug: string }> };

export default async function BookServicePage({ params }: Props) {
  const { businessSlug, serviceSlug } = await params;
  let embedAllowedOrigins: string[] | undefined;
  try {
    const profile = await apiGet<PortalProfile>(`/public/${businessSlug}`);
    embedAllowedOrigins = profile.branding?.embedAllowedOrigins;
  } catch {
    /* use postMessage fallback via referrer */
  }
  return <BookWizard businessSlug={businessSlug} serviceSlug={serviceSlug} embedAllowedOrigins={embedAllowedOrigins} />;
}