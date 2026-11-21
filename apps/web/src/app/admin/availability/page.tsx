'use client';

import { useState } from 'react';
import { EntityCrud } from '@/components/admin/EntityCrud';
import { OperatingHoursEditor } from '@/components/admin/OperatingHoursEditor';
import { AVAILABILITY_SECTIONS } from '@/lib/admin-availability-sections';

const SUB_TABS = [
  ...AVAILABILITY_SECTIONS.map((s) => ({ key: s.key, label: s.label, type: 'crud' as const })),
  { key: 'operating-hours', label: 'Operating hours', type: 'hours' as const },
];

export default function AvailabilityPage() {
  const [tab, setTab] = useState(SUB_TABS[0]!.key);
  const crudSection = AVAILABILITY_SECTIONS.find((s) => s.key === tab);

  if (tab === 'operating-hours') {
    return (
      <div>
        <div className="admin-actions" role="tablist">
          {SUB_TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className={tab === t.key ? 'portal-btn' : 'link-btn'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <h1>Availability</h1>
        <OperatingHoursEditor />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-actions" role="tablist">
        {SUB_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className={tab === t.key ? 'portal-btn' : 'link-btn'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {crudSection ? <EntityCrud title="Availability" sections={[crudSection]} hideSectionTabs /> : null}
    </div>
  );
}