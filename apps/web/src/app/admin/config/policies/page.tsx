'use client';

import { VersionedEditor } from '@/components/admin/VersionedEditor';

export default function PoliciesConfigPage() {
  return (
    <VersionedEditor
      title="Policies"
      basePath="/policies"
      schemaKey="policy"
      defaultBody={{ cancellation: { allowed: true }, reschedule: { allowed: true } }}
    />
  );
}