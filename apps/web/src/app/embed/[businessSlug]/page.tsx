import { redirect } from 'next/navigation';
import { EmbedCatalog } from '@/components/portal/EmbedCatalog';

type Props = { params: Promise<{ businessSlug: string }>; searchParams: Promise<{ service?: string }> };

export default async function EmbedPage({ params, searchParams }: Props) {
  const { businessSlug } = await params;
  const q = await searchParams;
  if (q.service) redirect(`/embed/${businessSlug}/book/${q.service}`);
  return <EmbedCatalog businessSlug={businessSlug} basePath={`/embed/${businessSlug}`} />;
}