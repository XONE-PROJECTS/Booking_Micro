'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { PublicService } from '@/lib/portal-api';

type Category = { id: string; name: string; slug: string };

export default function PortalHome() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const t = useTranslations('portal');
  const [services, setServices] = useState<PublicService[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string>('');

  useEffect(() => {
    void apiGet<PublicService[]>(`/public/${businessSlug}/services?pageSize=50`).then(setServices);
    void apiGet<Category[]>(`/public/${businessSlug}/categories`).then(setCategories).catch(() => setCategories([]));
  }, [businessSlug]);

  const filtered = useMemo(() => (categoryId ? services.filter((s) => s.categoryId === categoryId) : services), [categoryId, services]);

  return (
    <>
      <h1>{t('catalog')}</h1>
      {categories.length ? (
        <div className="catalog-filters" role="group" aria-label="Categories">
          <button type="button" className={!categoryId ? 'chip active' : 'chip'} onClick={() => setCategoryId('')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c.id} type="button" className={categoryId === c.id ? 'chip active' : 'chip'} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="catalog-grid">
        {filtered.map((s) => (
          <Link key={s.id} href={`/${businessSlug}/services/${s.slug}`} className="card catalog-card">
            {s.imageUrl ? <img src={s.imageUrl} alt="" /> : null}
            <strong>{s.name}</strong>
            {s.shortDescription ? <p>{s.shortDescription}</p> : null}
            {s.basePrice ? (
              <p className="portal-muted">
                {t('from')} {s.currency ?? 'PHP'} {s.basePrice}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
      {filtered.length === 0 ? <p className="card">{t('loading')}</p> : null}
    </>
  );
}

function motion({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}