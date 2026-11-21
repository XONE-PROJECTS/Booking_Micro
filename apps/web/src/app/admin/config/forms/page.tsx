'use client';

import { VersionedEditor } from '@/components/admin/VersionedEditor';

export default function FormsConfigPage() {
  return (
    <VersionedEditor
      title="Forms"
      basePath="/forms"
      schemaKey="schema"
      defaultBody={{ sections: [{ id: 'main', title: 'Details', fields: [] }] }}
    />
  );
}