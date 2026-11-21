'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { BookingConfirmation } from '@/components/portal/BookingConfirmation';

export default function ConfirmationPage() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const sp = useSearchParams();
  return <BookingConfirmation businessSlug={businessSlug} reference={sp.get('reference')} token={sp.get('token')} />;
}
