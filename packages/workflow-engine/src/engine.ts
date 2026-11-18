import { errors, evaluateCondition, type ErrorDetail, type IdentityContext, type PermissionKey } from '@universal-booking/core';
import {
  categoryRules,
  workflowDefinitionSchema,
  type StatusCategory,
  type TransitionGuard,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowStatus,
  type WorkflowStep,
  type WorkflowTransition,
} from './definition';

export interface WorkflowValidationResult {
  valid: boolean;
  errors: ErrorDetail[];
  definition?: WorkflowDefinition;
}

/** Save-time checks that stop tenants configuring workflows that could bypass inventory or payment rules. */
export function validateWorkflow(input: unknown): WorkflowValidationResult {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const def = parsed.data;
  const out: ErrorDetail[] = [];
  const statusByKey = new Map<string, WorkflowStatus>();
  def.statuses.forEach((s, i) => {
    if (statusByKey.has(s.key)) out.push({ path: `statuses.${i}.key`, message: `Duplicate status "${s.key}"` });
    statusByKey.set(s.key, s);
  });

  const drafts = def.statuses.filter((s) => s.category === 'draft');
  if (drafts.length !== 1) out.push({ path: 'statuses', message: 'Exactly one status must use the "draft" category (the starting status).' });
  for (const required of ['active', 'cancelled'] as StatusCategory[]) {
    if (!def.statuses.some((s) => s.category === required)) out.push({ path: 'statuses', message: `At least one status must use the "${required}" category.` });
  }

  def.transitions.forEach((tr, i) => {
    const from = statusByKey.get(tr.from);
    const to = statusByKey.get(tr.to);
    if (!from) out.push({ path: `transitions.${i}.from`, message: `Unknown status "${tr.from}"` });
    if (!to) out.push({ path: `transitions.${i}.to`, message: `Unknown status "${tr.to}"` });
    if (!from || !to) return;
    if (categoryRules[from.category].terminal) {
      out.push({ path: `transitions.${i}`, message: `"${from.key}" is final; it cannot transition to another status.` });
    }
    if (to.category === 'draft') out.push({ path: `transitions.${i}.to`, message: 'Bookings cannot return to the draft status.' });
    if (!categoryRules[from.category].paid && categoryRules[to.category].paid && !tr.guards.includes('payment_requirement_met')) {
      out.push({ path: `transitions.${i}.guards`, message: `Transition ${tr.from} -> ${tr.to} must keep the "payment_requirement_met" guard.` });
    }
    if (to.category === 'in_service' && !['active', 'in_service'].includes(from.category)) {
      out.push({ path: `transitions.${i}`, message: 'Only confirmed bookings can be checked in or started.' });
    }
  });

  // Every non-final status must be able to reach a final status.
  const terminal = new Set(def.statuses.filter((s) => categoryRules[s.category].terminal).map((s) => s.key));
  const canFinish = new Set(terminal);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tr of def.transitions) {
      if (!canFinish.has(tr.from) && canFinish.has(tr.to)) {
        canFinish.add(tr.from);
        changed = true;
      }
    }
  }
  for (const s of def.statuses) {
    if (!canFinish.has(s.key)) out.push({ path: 'transitions', message: `Status "${s.key}" can never reach a final status.` });
  }

  const types = def.steps.map((s) => s.type);
  if (!types.includes('confirm_booking')) out.push({ path: 'steps', message: 'The workflow needs a "confirm_booking" step.' });
  const holdIdx = types.indexOf('create_hold');
  const payIdx = types.indexOf('collect_payment');
  const confirmIdx = types.indexOf('confirm_booking');
  if (holdIdx === -1) out.push({ path: 'steps', message: 'The workflow needs a "create_hold" step so inventory is reserved.' });
  if (payIdx !== -1 && holdIdx !== -1 && payIdx < holdIdx) out.push({ path: 'steps', message: 'Payment must be collected after the hold is created.' });
  if (payIdx !== -1 && confirmIdx !== -1 && payIdx > confirmIdx) out.push({ path: 'steps', message: 'Payment must be collected before confirmation.' });
  if (types.filter((x) => x === 'collect_payment').length > 1) out.push({ path: 'steps', message: 'Only one payment step is allowed.' });

  return out.length ? { valid: false, errors: out } : { valid: true, errors: [], definition: def };
}

export function parseWorkflow(input: unknown): WorkflowDefinition {
  const result = validateWorkflow(input);
  if (!result.valid) throw errors.configuration('The workflow definition is invalid.', result.errors);
  return result.definition!;
}

export function statusOf(def: WorkflowDefinition, key: string): WorkflowStatus {
  const s = def.statuses.find((x) => x.key === key);
  if (!s) throw errors.configuration(`Status "${key}" is not part of the workflow.`);
  return s;
}

export const categoryOf = (def: WorkflowDefinition, key: string): StatusCategory => statusOf(def, key).category;

export function firstStatusIn(def: WorkflowDefinition, category: StatusCategory): WorkflowStatus {
  const s = def.statuses.find((x) => x.category === category);
  if (!s) throw errors.configuration(`The workflow has no status in category "${category}".`);
  return s;
}

export const initialStatus = (def: WorkflowDefinition) => firstStatusIn(def, 'draft');

export interface GuardContext {
  paymentRequirementMet: boolean;
  beforeStart: boolean;
  cancellationAllowed: boolean;
  resourcesAssigned: boolean;
}

function guardPasses(guard: TransitionGuard, ctx: GuardContext): boolean {
  switch (guard) {
    case 'payment_requirement_met':
      return ctx.paymentRequirementMet;
    case 'before_start':
      return ctx.beforeStart;
    case 'after_start':
      return !ctx.beforeStart;
    case 'cancellation_allowed':
      return ctx.cancellationAllowed;
    case 'resources_assigned':
      return ctx.resourcesAssigned;
  }
}

export type Actor = { kind: 'system' } | { kind: 'user'; identity: IdentityContext } | { kind: 'customer' };

export interface TransitionRequest {
  from: string;
  action: WorkflowAction;
  /** Preferred target when the action has several (for example pay -> pending or confirmed). */
  to?: string;
  actor: Actor;
  guards: GuardContext;
}

export interface ResolvedTransition {
  transition: WorkflowTransition;
  fromCategory: StatusCategory;
  toCategory: StatusCategory;
  inventory: 'activate' | 'release' | 'none';
}

export function inventoryEffect(from: StatusCategory, to: StatusCategory): 'activate' | 'release' | 'none' {
  const a = categoryRules[from].inventory;
  const b = categoryRules[to].inventory;
  if (b === 'none' && a !== 'none') return 'release';
  if (a === 'held' && b === 'active') return 'activate';
  return 'none';
}

/** Validates and resolves a status change. System invariants (payment, final statuses) are always enforced. */
export function resolveTransition(def: WorkflowDefinition, req: TransitionRequest): ResolvedTransition {
  const fromCategory = categoryOf(def, req.from);
  const candidates = def.transitions.filter((t) => t.from === req.from && t.action === req.action && (!req.to || t.to === req.to));
  if (!candidates.length) throw errors.invalidTransition(req.from, req.action);

  const permitted = candidates.filter((t) => {
    if (req.actor.kind === 'system') return true;
    if (req.actor.kind === 'customer') return t.customerAllowed;
    const id = req.actor.identity;
    return id.isPlatformAdmin || t.permissions.some((p) => id.permissions.includes(p as PermissionKey));
  });
  if (!permitted.length) throw errors.forbidden(`You are not allowed to ${req.action.replace('_', ' ')} this booking.`);

  const transition = permitted.find((t) => t.guards.every((g) => guardPasses(g, req.guards)));
  if (!transition) {
    const failing = permitted[0]!.guards.filter((g) => !guardPasses(g, req.guards));
    if (failing.includes('payment_requirement_met')) throw errors.policy('Payment must be completed before this booking can be confirmed.');
    if (failing.includes('cancellation_allowed')) throw errors.policy('This booking can no longer be cancelled under the cancellation policy.');
    throw errors.policy(`Requirements not met: ${failing.join(', ')}`);
  }
  const toCategory = categoryOf(def, transition.to);
  if (categoryRules[fromCategory].terminal) throw errors.invalidTransition(req.from, req.action);
  if (!categoryRules[fromCategory].paid && categoryRules[toCategory].paid && !req.guards.paymentRequirementMet) {
    throw errors.policy('Payment must be completed before this booking can be confirmed.');
  }
  return { transition, fromCategory, toCategory, inventory: inventoryEffect(fromCategory, toCategory) };
}

export function availableActions(def: WorkflowDefinition, status: string): WorkflowAction[] {
  return [...new Set(def.transitions.filter((t) => t.from === status).map((t) => t.action))];
}

// ---------------------------------------------------------------------------
// Step pipeline
// ---------------------------------------------------------------------------

export interface PipelineContext {
  paymentRequired: boolean;
  approvalRequired: boolean;
  /** Facts available to conditional steps, for example { total: 12000, guests: { total: 8 } }. */
  facts: Record<string, unknown>;
}

export type WaitingStep = 'collect_payment' | 'admin_approval' | 'manual_review' | 'confirm_booking';

function stepApplies(step: WorkflowStep, ctx: PipelineContext): boolean {
  const conditionOk = evaluateCondition(step.condition, ctx.facts);
  switch (step.type) {
    case 'collect_payment':
      return ctx.paymentRequired && step.required !== false && conditionOk;
    case 'admin_approval':
    case 'manual_review':
      return ctx.approvalRequired || (step.required === true && conditionOk) || (step.required !== true && !!step.condition && conditionOk);
    case 'confirm_booking':
      return true;
    default:
      return false;
  }
}

/** Normalized steps; a payment step is inserted when payment is required but the workflow omits it. */
export function effectiveSteps(def: WorkflowDefinition, ctx: PipelineContext): WorkflowStep[] {
  const steps = [...def.steps];
  if (ctx.paymentRequired && !steps.some((s) => s.type === 'collect_payment')) {
    const confirmIdx = steps.findIndex((s) => s.type === 'confirm_booking');
    steps.splice(confirmIdx === -1 ? steps.length : confirmIdx, 0, { type: 'collect_payment', required: true });
  }
  if (ctx.approvalRequired && !steps.some((s) => s.type === 'admin_approval' || s.type === 'manual_review')) {
    const confirmIdx = steps.findIndex((s) => s.type === 'confirm_booking');
    steps.splice(confirmIdx === -1 ? steps.length : confirmIdx, 0, { type: 'admin_approval', required: true });
  }
  return steps;
}

export interface PipelinePosition {
  waitingFor: WaitingStep;
  stepIndex: number;
  status: WorkflowStatus;
  notifications: string[];
}

const statusForStep = (def: WorkflowDefinition, step: WaitingStep): WorkflowStatus =>
  step === 'collect_payment'
    ? firstStatusIn(def, 'awaiting_payment')
    : step === 'confirm_booking'
      ? firstStatusIn(def, 'active')
      : firstStatusIn(def, 'pending');

/** Finds where the booking waits next, starting after `afterIndex` (use the create_hold index on creation). */
export function nextPosition(def: WorkflowDefinition, ctx: PipelineContext, afterIndex: number): PipelinePosition {
  const steps = effectiveSteps(def, ctx);
  const notifications: string[] = [];
  for (let i = afterIndex + 1; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type === 'send_notification') {
      const template = typeof step.config?.template === 'string' ? step.config.template : null;
      if (template && evaluateCondition(step.condition, ctx.facts)) notifications.push(template);
      continue;
    }
    if ((step.type === 'collect_payment' || step.type === 'admin_approval' || step.type === 'manual_review' || step.type === 'confirm_booking') && stepApplies(step, ctx)) {
      const waitingFor = step.type as WaitingStep;
      // Trailing notifications after confirmation fire together with it.
      if (waitingFor === 'confirm_booking') {
        for (const s of steps.slice(i + 1)) {
          if (s.type === 'send_notification' && typeof s.config?.template === 'string' && evaluateCondition(s.condition, ctx.facts)) notifications.push(s.config.template);
        }
      }
      return { waitingFor, stepIndex: i, status: statusForStep(def, waitingFor), notifications };
    }
  }
  return { waitingFor: 'confirm_booking', stepIndex: steps.length - 1, status: firstStatusIn(def, 'active'), notifications };
}

export function creationPosition(def: WorkflowDefinition, ctx: PipelineContext): PipelinePosition {
  const steps = effectiveSteps(def, ctx);
  const holdIdx = steps.findIndex((s) => s.type === 'create_hold');
  return nextPosition(def, ctx, holdIdx === -1 ? -1 : holdIdx);
}

/** Auto-cancel configuration (minutes after creation) if the workflow defines one. */
export function autoCancelMinutes(def: WorkflowDefinition): number | null {
  const step = def.steps.find((s) => s.type === 'auto_cancel');
  const v = step?.config?.afterMinutes;
  return typeof v === 'number' && v > 0 ? v : null;
}
