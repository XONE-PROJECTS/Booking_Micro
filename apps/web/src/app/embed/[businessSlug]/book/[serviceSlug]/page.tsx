import { apiGet } from '@/lib/api';
import type { PortalProfile } from '@/lib/portal-api';
import { BookWizard } from '@/components/portal/BookWizard';

type Props = { params: Promise<{ businessSlug: string; serviceSlug: string }> };

export default async function EmbedBookPage({ params }: Props) {
  const { businessSlug, serviceSlug } = await params;
  let embedAllowedOrigins: string[] | undefined;
  try {
    const profile = await apiGet<PortalProfile>(`/public/${businessSlug}`);
    embedAllowedOrigins = profile.branding?.embedAllowedOrigins;
  } catch {
    /* offline */
  }
  return (
    <BookWizard
      businessSlug={businessSlug}
      serviceSlug={serviceSlug}
      embedAllowedOrigins={embedAllowedOrigins}
      compact
      basePath={`/embed/${businessSlug}`}
    />
  );
}