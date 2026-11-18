import { describe, expect, it } from 'vitest';
import {
  compileExpression,
  evaluateCondition,
  formSchemaDefinition,
  moneyString,
  subtractIntervals,
  validateFormSubmission,
  windowsForDate,
  zoned,
  ExpressionError,
} from '../src';
import { SecretBox } from '../src/node';

describe('expression evaluator', () => {
  const vars = ['base', 'nights', 'guests'] as const;
  it('evaluates arithmetic with precedence and functions', () => {
    const f = compileExpression('base * nights + max(0, guests - 2) * 500', vars);
    expect(f.evaluate({ base: 3500, nights: 3, guests: 4 }).toString()).toBe('11500');
  });
  it('supports if() and comparisons', () => {
    const f = compileExpression('if(nights >= 7, base * nights * 0.9, base * nights)', vars);
    expect(f.evaluate({ base: 100, nights: 7, guests: 0 }).toString()).toBe('630');
    expect(f.evaluate({ base: 100, nights: 2, guests: 0 }).toString()).toBe('200');
  });
  it('rejects unknown identifiers and property access', () => {
    expect(() => compileExpression('process.exit()', vars)).toThrow(ExpressionError);
    expect(() => compileExpression('constructor', vars)).toThrow(ExpressionError);
    expect(() => compileExpression('eval(1)', vars)).toThrow(ExpressionError);
  });
  it('guards division by zero', () => {
    expect(() => compileExpression('base / 0', vars).evaluate({ base: 1 })).toThrow(ExpressionError);
  });
});

describe('conditions', () => {
  it('evaluates nested conditions', () => {
    const c = { all: [{ field: 'total', op: 'gt' as const, value: 10000 }, { any: [{ field: 'guests.total', op: 'gte' as const, value: 8 }, { field: 'vip', op: 'eq' as const, value: true }] }] };
    expect(evaluateCondition(c, { total: 12000, guests: { total: 9 } })).toBe(true);
    expect(evaluateCondition(c, { total: 12000, guests: { total: 2 } })).toBe(false);
    expect(evaluateCondition(c, { total: 12000, guests: { total: 2 }, vip: true })).toBe(true);
  });
  it('does not traverse prototypes', () => {
    expect(evaluateCondition({ field: '__proto__.polluted', op: 'exists' }, {})).toBe(false);
  });
});

describe('form validation', () => {
  const form = formSchemaDefinition.parse({
    fields: [
      { key: 'special_request', type: 'textarea', label: 'Special request' },
      { key: 'arrival', type: 'select', label: 'Arrival', required: true, options: [{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Evening' }] },
      { key: 'flight_no', type: 'text', label: 'Flight', required: true, visibleWhen: { field: 'arrival', op: 'eq', value: 'pm' } },
      { key: 'terms', type: 'consent', label: 'Terms', required: true },
    ],
  });
  it('enforces required, options and consent', () => {
    const r = validateFormSubmission(form, { arrival: 'noon' });
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['answers.arrival', 'answers.terms']));
  });
  it('applies conditional visibility', () => {
    expect(validateFormSubmission(form, { arrival: 'am', terms: true }).valid).toBe(true);
    expect(validateFormSubmission(form, { arrival: 'pm', terms: true }).valid).toBe(false);
    const ok = validateFormSubmission(form, { arrival: 'pm', terms: true, flight_no: 'PR101', hidden: 'x' });
    expect(ok.valid).toBe(true);
    expect(ok.values).not.toHaveProperty('hidden');
  });
  it('rejects duplicate keys and missing options', () => {
    expect(formSchemaDefinition.safeParse({ fields: [{ key: 'a', type: 'text', label: 'A' }, { key: 'a', type: 'text', label: 'B' }] }).success).toBe(false);
    expect(formSchemaDefinition.safeParse({ fields: [{ key: 'a', type: 'select', label: 'A' }] }).success).toBe(false);
  });
});

describe('money and time', () => {
  it('rounds per currency minor units', () => {
    expect(moneyString('10.005', 'PHP')).toBe('10.01');
    expect(moneyString('1000.5', 'JPY')).toBe('1001');
    expect(moneyString('1.2345', 'KWD')).toBe('1.235');
  });
  it('generates windows in local time across a DST change', () => {
    // New York springs forward on 2026-03-08; a 09:00-17:00 window stays 09:00 local.
    const w = windowsForDate([{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00' }], '2026-03-08', 'America/New_York');
    expect(w[0]!.start.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(w[0]!.end.toISOString()).toBe('2026-03-08T21:00:00.000Z');
  });
  it('handles windows past midnight', () => {
    const w = windowsForDate([{ dayOfWeek: 5, startTime: '18:00', endTime: '02:00' }], '2026-11-20', 'Asia/Manila');
    expect(w[0]!.end.getTime() - w[0]!.start.getTime()).toBe(8 * 3600_000);
  });
  it('subtracts intervals', () => {
    const d = (h: number) => zoned('2026-12-01', `${String(h).padStart(2, '0')}:00`, 'UTC');
    const r = subtractIntervals([{ start: d(9), end: d(17) }], [{ start: d(12), end: d(13) }]);
    expect(r).toHaveLength(2);
  });
});

describe('SecretBox', () => {
  it('round-trips and detects tampering', () => {
    const box = new SecretBox('x'.repeat(32));
    const sealed = box.encryptJson({ secretKey: 'sk_test' });
    expect(box.decryptJson(sealed)).toEqual({ secretKey: 'sk_test' });
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => box.decrypt(tampered)).toThrow();
  });
});
