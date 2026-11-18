import { describe, expect, it } from 'vitest';
import { anonymousIdentity, defaultRolePermissions, type IdentityContext } from '@universal-booking/core';
import { creationPosition, defaultWorkflow, nextPosition, resolveTransition, validateWorkflow, type GuardContext, type WorkflowDefinition } from '../src';

const guards = (over: Partial<GuardContext> = {}): GuardContext => ({ paymentRequirementMet: true, beforeStart: true, cancellationAllowed: true, resourcesAssigned: true, ...over });
const staff: IdentityContext = { ...anonymousIdentity('t1'), principalId: 'u1', principalType: 'user', roles: ['staff'], permissions: [...defaultRolePermissions.staff.permissions], source: 'internal' };
const admin: IdentityContext = { ...staff, roles: ['business_admin'], permissions: [...defaultRolePermissions.business_admin.permissions] };
const clone = (): WorkflowDefinition => structuredClone(defaultWorkflow);

describe('workflow validation', () => {
  it('accepts the default workflow', () => {
    expect(validateWorkflow(defaultWorkflow).valid).toBe(true);
  });
  it('rejects removing the payment guard from a confirm transition', () => {
    const wf = clone();
    wf.transitions.find((t) => t.from === 'awaiting_payment' && t.action === 'confirm')!.guards = [];
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes('payment_requirement_met'))).toBe(true);
  });
  it('rejects transitions out of final statuses and dead ends', () => {
    const wf = clone();
    wf.transitions.push({ from: 'cancelled', to: 'confirmed', action: 'confirm', permissions: [], customerAllowed: false, guards: ['payment_requirement_met'], effects: [] });
    wf.statuses.push({ key: 'limbo', label: 'Limbo', category: 'pending' });
    const r = validateWorkflow(wf);
    expect(r.errors.some((e) => e.message.includes('final'))).toBe(true);
    expect(r.errors.some((e) => e.message.includes('"limbo"'))).toBe(true);
  });
  it('requires a hold before payment', () => {
    const wf = clone();
    wf.steps = [{ type: 'collect_payment' }, { type: 'create_hold' }, { type: 'confirm_booking' }];
    expect(validateWorkflow(wf).valid).toBe(false);
  });
});

describe('transitions', () => {
  it('lets staff with permission approve and reports inventory effects', () => {
    const r = resolveTransition(defaultWorkflow, { from: 'awaiting_payment', action: 'confirm', actor: { kind: 'user', identity: admin }, guards: guards() });
    expect(r.transition.to).toBe('confirmed');
    expect(r.inventory).toBe('activate');
  });
  it('blocks confirmation without payment', () => {
    expect(() => resolveTransition(defaultWorkflow, { from: 'awaiting_payment', action: 'confirm', actor: { kind: 'user', identity: admin }, guards: guards({ paymentRequirementMet: false }) })).toThrow(/Payment/);
  });
  it('blocks actors without permission', () => {
    const noApprove = { ...staff, permissions: staff.permissions.filter((p) => p !== 'bookings.approve') };
    expect(() => resolveTransition(defaultWorkflow, { from: 'pending', action: 'approve', actor: { kind: 'user', identity: noApprove }, guards: guards() })).toThrow(/not allowed/);
  });
  it('lets customers cancel only where allowed and within policy', () => {
    const r = resolveTransition(defaultWorkflow, { from: 'confirmed', action: 'cancel', actor: { kind: 'customer' }, guards: guards() });
    expect(r.inventory).toBe('release');
    expect(() => resolveTransition(defaultWorkflow, { from: 'confirmed', action: 'cancel', actor: { kind: 'customer' }, guards: guards({ cancellationAllowed: false }) })).toThrow(/cancellation policy/);
    expect(() => resolveTransition(defaultWorkflow, { from: 'checked_in', action: 'cancel', actor: { kind: 'customer' }, guards: guards() })).toThrow();
  });
  it('rejects unknown transitions', () => {
    expect(() => resolveTransition(defaultWorkflow, { from: 'completed', action: 'cancel', actor: { kind: 'system' }, guards: guards() })).toThrow();
  });
  it('only marks no-shows after the start', () => {
    expect(() => resolveTransition(defaultWorkflow, { from: 'confirmed', action: 'mark_no_show', actor: { kind: 'user', identity: admin }, guards: guards() })).toThrow();
    expect(resolveTransition(defaultWorkflow, { from: 'confirmed', action: 'mark_no_show', actor: { kind: 'user', identity: admin }, guards: guards({ beforeStart: false }) }).transition.to).toBe('no_show');
  });
});

describe('step pipeline', () => {
  it('auto-confirms when nothing is required', () => {
    const p = creationPosition(defaultWorkflow, { paymentRequired: false, approvalRequired: false, facts: {} });
    expect(p.status.key).toBe('confirmed');
    expect(p.notifications).toContain('booking.created');
  });
  it('waits for payment, then approval', () => {
    const ctx = { paymentRequired: true, approvalRequired: true, facts: {} };
    const p = creationPosition(defaultWorkflow, ctx);
    expect(p.status.key).toBe('awaiting_payment');
    const next = nextPosition(defaultWorkflow, ctx, p.stepIndex);
    expect(next.status.key).toBe('pending');
    expect(nextPosition(defaultWorkflow, ctx, next.stepIndex).status.key).toBe('confirmed');
  });
  it('inserts a payment step when the workflow omits it', () => {
    const wf = clone();
    wf.steps = [{ type: 'create_hold' }, { type: 'confirm_booking' }];
    expect(creationPosition(wf, { paymentRequired: true, approvalRequired: false, facts: {} }).status.key).toBe('awaiting_payment');
  });
  it('runs conditional approval steps', () => {
    const wf = clone();
    wf.steps = [{ type: 'create_hold' }, { type: 'admin_approval', condition: { field: 'guests.total', op: 'gt', value: 10 } }, { type: 'confirm_booking' }];
    expect(creationPosition(wf, { paymentRequired: false, approvalRequired: false, facts: { guests: { total: 12 } } }).status.key).toBe('pending');
    expect(creationPosition(wf, { paymentRequired: false, approvalRequired: false, facts: { guests: { total: 4 } } }).status.key).toBe('confirmed');
  });
});
