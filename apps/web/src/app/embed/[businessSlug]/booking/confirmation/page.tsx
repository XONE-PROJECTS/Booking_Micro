'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function EmbedConfirmationPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const sp = useSearchParams();
  const t = useTranslations('portal');
  const reference = sp.get('reference');
  const token = sp.get('token');

  return (
    <section className="card embed-confirmation" role="status">
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
      <p className="portal-muted">You can close this window or continue in the full portal.</p>
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