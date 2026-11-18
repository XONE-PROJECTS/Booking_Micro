import { z } from 'zod';
import { conditionSchema, permissionKeys } from '@universal-booking/core';

/** Fixed system categories. Each tenant status maps to one; the category decides inventory and payment behavior. */
export const statusCategories = ['draft', 'pending', 'awaiting_payment', 'active', 'in_service', 'completed', 'cancelled'] as const;
export type StatusCategory = (typeof statusCategories)[number];

export const categoryRules: Record<StatusCategory, { inventory: 'held' | 'active' | 'none'; terminal: boolean; paid: boolean }> = {
  draft: { inventory: 'held', terminal: false, paid: false },
  awaiting_payment: { inventory: 'held', terminal: false, paid: false },
  pending: { inventory: 'active', terminal: false, paid: false },
  active: { inventory: 'active', terminal: false, paid: true },
  in_service: { inventory: 'active', terminal: false, paid: true },
  completed: { inventory: 'active', terminal: true, paid: true },
  cancelled: { inventory: 'none', terminal: true, paid: false },
};

export const workflowActions = [
  'submit',
  'request_payment',
  'pay',
  'approve',
  'reject',
  'confirm',
  'cancel',
  'check_in',
  'start',
  'check_out',
  'complete',
  'mark_no_show',
  'expire',
] as const;
export type WorkflowAction = (typeof workflowActions)[number];

export const transitionGuards = ['payment_requirement_met', 'before_start', 'after_start', 'cancellation_allowed', 'resources_assigned'] as const;
export type TransitionGuard = (typeof transitionGuards)[number];

export const stepTypes = [
  'validate_availability',
  'calculate_pricing',
  'create_hold',
  'collect_payment',
  'admin_approval',
  'manual_review',
  'confirm_booking',
  'send_notification',
  'auto_cancel',
  'expire',
] as const;
export type StepType = (typeof stepTypes)[number];

export const statusSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(40),
  label: z.string().min(1).max(60),
  category: z.enum(statusCategories),
  color: z.string().max(20).optional(),
});

export const effectSchema = z.object({
  type: z.enum(['notify', 'emit_event']),
  template: z.string().max(80).optional(),
  event: z.string().max(80).optional(),
  channels: z.array(z.enum(['email', 'sms', 'in_app'])).optional(),
});

export const transitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  action: z.enum(workflowActions),
  label: z.string().max(60).optional(),
  /** Permission keys allowed to perform the transition. Empty means system-only. */
  permissions: z.array(z.enum(permissionKeys)).default([]),
  /** Customers may perform it on their own booking (for example cancel). */
  customerAllowed: z.boolean().default(false),
  guards: z.array(z.enum(transitionGuards)).default([]),
  effects: z.array(effectSchema).default([]),
});

export const stepSchema = z.object({
  type: z.enum(stepTypes),
  required: z.boolean().optional(),
  condition: conditionSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const workflowDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  statuses: z.array(statusSchema).min(2).max(40),
  transitions: z.array(transitionSchema).max(200),
  steps: z.array(stepSchema).min(1).max(30),
});

export type WorkflowStatus = z.infer<typeof statusSchema>;
export type WorkflowTransition = z.infer<typeof transitionSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;

const t = (
  from: string,
  to: string,
  action: WorkflowAction,
  permissions: WorkflowTransition['permissions'],
  extra: Partial<WorkflowTransition> = {},
): WorkflowTransition => ({ from, to, action, permissions, customerAllowed: false, guards: [], effects: [], ...extra });

/** The blueprint's default lifecycle, extended with draft -> confirmed for auto-confirmed bookings. */
export const defaultWorkflow: WorkflowDefinition = {
  name: 'Standard booking',
  statuses: [
    { key: 'draft', label: 'Draft', category: 'draft', color: 'gray' },
    { key: 'pending', label: 'Pending', category: 'pending', color: 'amber' },
    { key: 'awaiting_payment', label: 'Awaiting Payment', category: 'awaiting_payment', color: 'orange' },
    { key: 'confirmed', label: 'Confirmed', category: 'active', color: 'green' },
    { key: 'checked_in', label: 'Checked In', category: 'in_service', color: 'blue' },
    { key: 'in_progress', label: 'In Progress', category: 'in_service', color: 'indigo' },
    { key: 'completed', label: 'Completed', category: 'completed', color: 'emerald' },
    { key: 'cancelled', label: 'Cancelled', category: 'cancelled', color: 'red' },
    { key: 'rejected', label: 'Rejected', category: 'cancelled', color: 'rose' },
    { key: 'no_show', label: 'No Show', category: 'cancelled', color: 'slate' },
    { key: 'expired', label: 'Expired', category: 'cancelled', color: 'zinc' },
  ],
  transitions: [
    t('draft', 'pending', 'submit', []),
    t('draft', 'awaiting_payment', 'request_payment', []),
    t('draft', 'confirmed', 'confirm', [], { guards: ['payment_requirement_met'], effects: [{ type: 'notify', template: 'booking.confirmed' }] }),
    t('draft', 'cancelled', 'cancel', ['bookings.cancel']),
    t('draft', 'expired', 'expire', []),
    t('pending', 'confirmed', 'approve', ['bookings.approve'], { guards: ['payment_requirement_met'], effects: [{ type: 'notify', template: 'booking.confirmed' }] }),
    t('pending', 'rejected', 'reject', ['bookings.approve'], { effects: [{ type: 'notify', template: 'booking.rejected' }] }),
    t('pending', 'cancelled', 'cancel', ['bookings.cancel'], { customerAllowed: true, guards: ['cancellation_allowed'], effects: [{ type: 'notify', template: 'booking.cancelled' }] }),
    t('awaiting_payment', 'pending', 'pay', []),
    t('awaiting_payment', 'confirmed', 'pay', [], { guards: ['payment_requirement_met'], effects: [{ type: 'notify', template: 'booking.confirmed' }] }),
    t('awaiting_payment', 'confirmed', 'confirm', ['bookings.confirm'], { guards: ['payment_requirement_met'], effects: [{ type: 'notify', template: 'booking.confirmed' }] }),
    t('awaiting_payment', 'expired', 'expire', [], { effects: [{ type: 'notify', template: 'booking.expired' }] }),
    t('awaiting_payment', 'cancelled', 'cancel', ['bookings.cancel'], { customerAllowed: true, effects: [{ type: 'notify', template: 'booking.cancelled' }] }),
    t('confirmed', 'checked_in', 'check_in', ['bookings.check_in'], { effects: [{ type: 'notify', template: 'booking.checked_in' }] }),
    t('confirmed', 'cancelled', 'cancel', ['bookings.cancel'], { customerAllowed: true, guards: ['cancellation_allowed'], effects: [{ type: 'notify', template: 'booking.cancelled' }] }),
    t('confirmed', 'no_show', 'mark_no_show', ['bookings.check_in'], { guards: ['after_start'] }),
    t('checked_in', 'in_progress', 'start', ['bookings.check_in']),
    t('checked_in', 'completed', 'check_out', ['bookings.check_in'], { effects: [{ type: 'notify', template: 'booking.completed' }] }),
    t('in_progress', 'completed', 'complete', ['bookings.check_in'], { effects: [{ type: 'notify', template: 'booking.completed' }] }),
    t('in_progress', 'completed', 'check_out', ['bookings.check_in'], { effects: [{ type: 'notify', template: 'booking.completed' }] }),
  ],
  steps: [
    { type: 'validate_availability' },
    { type: 'calculate_pricing' },
    { type: 'create_hold' },
    { type: 'collect_payment', required: true },
    { type: 'admin_approval', required: false },
    { type: 'confirm_booking' },
    { type: 'send_notification', config: { template: 'booking.created' } },
  ],
};
