'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function ConfirmationPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const sp = useSearchParams();
  const t = useTranslations('portal');
  const reference = sp.get('reference');
  const token = sp.get('token');

  return (
    <section className="card" role="status">
      <h1>Booking confirmed</h1>
      {reference ? (
        <p>
          {t('reference')}: <strong>{reference}</strong>
        </p>
      ) : null}
      {token ? (
        <p>
          {t('saveToken')}: <code>{token}</code>
        </p>
      ) : null}
      <p>
        <Link href={`/${businessSlug}/lookup`}>{t('lookup')}</Link>
        {token ? (
          <>
            {' · '}
            <Link href={`/${businessSlug}/account/bookings/guest?reference=${reference}&token=${token}`}>Manage booking</Link>
          </>
        ) : null}
      </p>
    </section>
  );
}