'use client';

import { VersionedEditor } from '@/components/admin/VersionedEditor';

export default function WorkflowsConfigPage() {
  return (
    <VersionedEditor
      title="Workflows"
      basePath="/workflows"
      schemaKey="definition"
      defaultBody={{ statuses: [{ key: 'pending', label: 'Pending', category: 'active' }], transitions: [] }}
    />
  );
}