'use client';

import { EntityCrud } from '@/components/admin/EntityCrud';
import { PRICING_SECTIONS } from '@/lib/admin-pricing-sections';

export default function PricingPage() {
  return <EntityCrud title="Pricing" sections={PRICING_SECTIONS} />;
}