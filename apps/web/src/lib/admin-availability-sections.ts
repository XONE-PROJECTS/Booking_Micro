import type { CrudSection } from '@/components/admin/EntityCrud';

export const AVAILABILITY_SECTIONS: CrudSection[] = [
  {
    key: 'rules',
    label: 'Rules',
    path: '/availability/rules',
    defaults: { kind: 'window', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    fields: [
      { key: 'serviceId', label: 'Service', type: 'service' },
      { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'window', label: 'Window' }, { value: 'session', label: 'Session' }], showInTable: true },
      { key: 'dayOfWeek', label: 'Day (0=Sun)', type: 'number', showInTable: true },
      { key: 'startTime', label: 'Start time', showInTable: true },
      { key: 'endTime', label: 'End time', showInTable: true },
      { key: 'capacity', label: 'Capacity', type: 'number', optional: true, showInTable: false },
      { key: 'label', label: 'Label', optional: true, showInTable: true },
    ],
  },
  {
    key: 'exceptions',
    label: 'Exceptions',
    path: '/availability/exceptions',
    defaults: { targetType: 'business', kind: 'closed' },
    fields: [
      { key: 'targetType', label: 'Target', type: 'select', options: [{ value: 'business', label: 'Business' }, { value: 'service', label: 'Service' }, { value: 'resource', label: 'Resource' }], showInTable: true },
      { key: 'targetId', label: 'Target ID', optional: true, showInTable: false },
      { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'closed', label: 'Closed' }, { value: 'open', label: 'Open' }], showInTable: true },
      { key: 'startsAt', label: 'Starts', type: 'datetime', showInTable: true },
      { key: 'endsAt', label: 'Ends', type: 'datetime', showInTable: true },
      { key: 'reason', label: 'Reason', type: 'textarea', optional: true, showInTable: true },
    ],
  },
  {
    key: 'blackouts',
    label: 'Blackouts',
    path: '/availability/blackouts',
    defaults: {},
    allowUpdate: false,
    fields: [
      { key: 'serviceId', label: 'Service', type: 'service', optional: true, showInTable: false },
      { key: 'startDate', label: 'Start date', type: 'date', showInTable: true },
      { key: 'endDate', label: 'End date', type: 'date', showInTable: true },
      { key: 'reason', label: 'Reason', optional: true, showInTable: true },
    ],
  },
];