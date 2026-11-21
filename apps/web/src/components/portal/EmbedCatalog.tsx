'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { PublicService } from '@/lib/portal-api';

export function EmbedCatalog({ businessSlug, basePath }: { businessSlug: string; basePath: string }) {
  const [services, setServices] = useState<PublicService[]>([]);

  useEffect(() => {
    void apiGet<PublicService[]>(`/public/${businessSlug}/services?pageSize=50`).then(setServices);
  }, [businessSlug]);

  const hrefBase = basePath.replace(/\/$/, '');

  return (
    <>
      <h1 className="embed-title">Book now</h1>
      <div className="embed-catalog">
        {services.map((s) => (
          <Link key={s.id} href={`${hrefBase}/book/${s.slug}`} className="card embed-card">
            <strong>{s.name}</strong>
            {s.shortDescription ? <p className="portal-muted">{s.shortDescription}</p> : null}
            {s.basePrice ? (
              <p className="portal-muted">
                From {s.currency ?? 'PHP'} {s.basePrice}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
      {services.length === 0 ? <p className="portal-muted">No services available.</p> : null}
    </>
  );
}