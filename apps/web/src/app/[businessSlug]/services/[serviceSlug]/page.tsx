import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { PublicService } from '@/lib/portal-api';

type Props = { params: Promise<{ businessSlug: string; serviceSlug: string }> };

export default async function ServiceDetailPage({ params }: Props) {
  const { businessSlug, serviceSlug } = await params;
  let service: PublicService | null = null;
  try {
    service = await apiGet<PublicService>(`/public/${businessSlug}/services/${serviceSlug}`);
  } catch {
    /* missing */
  }

  if (!service) {
    return <p>Service not found.</p>;
  }

  return (
    <article className="card">
      {service.imageUrl ? <img src={service.imageUrl} alt="" width={640} height={360} style={{ width: '100%', borderRadius: 12 }} /> : null}
      <h1>{service.name}</h1>
      {service.description ? <p>{service.description}</p> : service.shortDescription ? <p>{service.shortDescription}</p> : null}
      {service.basePrice ? (
        <p>
          From {service.currency ?? 'PHP'} {service.basePrice}
        </p>
      ) : null}
      <p>
        <Link className="portal-btn" href={`/${businessSlug}/book/${serviceSlug}`}>
          Book now
        </Link>
      </p>
    </article>
  );
}