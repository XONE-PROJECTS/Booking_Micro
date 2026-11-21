import type { CrudSection } from '@/components/admin/EntityCrud';

const activeField = { key: 'active', label: 'Active', type: 'boolean' as const, optional: true, showInTable: true };

export const PRICING_SECTIONS: CrudSection[] = [
  {
    key: 'rules',
    label: 'Rules',
    path: '/pricing/rules',
    defaults: { kind: 'base', strategy: 'fixed', configuration: {}, priority: 0, active: true },
    fields: [
      { key: 'serviceId', label: 'Service', type: 'service', showInTable: false },
      { key: 'name', label: 'Name', showInTable: true },
      { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'base', label: 'Base' }, { value: 'resource', label: 'Resource' }, { value: 'dynamic', label: 'Dynamic' }], showInTable: true },
      { key: 'strategy', label: 'Strategy', showInTable: true },
      { key: 'configuration', label: 'Configuration (JSON)', type: 'json', optional: true, showInTable: false },
      { key: 'priority', label: 'Priority', type: 'number', optional: true, showInTable: true },
      activeField,
    ],
  },
  {
    key: 'taxes',
    label: 'Taxes',
    path: '/pricing/taxes',
    defaults: { inclusive: false, serviceIds: [], sortOrder: 0, active: true },
    fields: [
      { key: 'name', label: 'Name', showInTable: true },
      { key: 'rate', label: 'Rate %', showInTable: true },
      { key: 'inclusive', label: 'Tax inclusive', type: 'boolean', optional: true, showInTable: true },
      { key: 'sortOrder', label: 'Sort order', type: 'number', optional: true, showInTable: false },
      activeField,
    ],
  },
  {
    key: 'fees',
    label: 'Fees',
    path: '/pricing/fees',
    defaults: { type: 'fixed', serviceIds: [], active: true },
    fields: [
      { key: 'name', label: 'Name', showInTable: true },
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'fixed', label: 'Fixed' }, { value: 'percent', label: 'Percent' }], showInTable: true },
      { key: 'value', label: 'Value', showInTable: true },
      activeField,
    ],
  },
  {
    key: 'discounts',
    label: 'Discounts',
    path: '/pricing/discounts',
    defaults: { type: 'percent', serviceIds: [], automatic: false, active: true },
    fields: [
      { key: 'name', label: 'Name', showInTable: true },
      { key: 'code', label: 'Promo code', optional: true, showInTable: true },
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Fixed' }], showInTable: true },
      { key: 'value', label: 'Value', showInTable: true },
      { key: 'automatic', label: 'Automatic', type: 'boolean', optional: true, showInTable: true },
      activeField,
    ],
  },
  {
    key: 'seasonal-rates',
    label: 'Seasonal rates',
    path: '/pricing/seasonal-rates',
    defaults: { priority: 0, active: true },
    fields: [
      { key: 'serviceId', label: 'Service', type: 'service', optional: true, showInTable: false },
      { key: 'name', label: 'Name', showInTable: true },
      { key: 'startsOn', label: 'Starts on', type: 'date', showInTable: true },
      { key: 'endsOn', label: 'Ends on', type: 'date', showInTable: true },
      { key: 'amount', label: 'Amount', optional: true, showInTable: true },
      { key: 'adjustmentPercent', label: 'Adjustment %', optional: true, showInTable: false },
      { key: 'priority', label: 'Priority', type: 'number', optional: true, showInTable: false },
      activeField,
    ],
  },
];