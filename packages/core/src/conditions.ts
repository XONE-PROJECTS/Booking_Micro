import { z } from 'zod';

export const conditionOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'exists', 'notExists', 'contains'] as const;
export type ConditionOperator = (typeof conditionOperators)[number];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: ConditionOperator; value?: unknown };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
    z.object({
      field: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.]+$/),
      op: z.enum(conditionOperators),
      value: z.unknown().optional(),
    }),
  ]),
);

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const asComparable = (v: unknown): number | string | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return undefined;
};

export function evaluateCondition(condition: Condition | undefined | null, context: unknown): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, context));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);

  const actual = getPath(context, condition.field);
  const expected = condition.value;
  switch (condition.op) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'notExists':
      return actual === undefined || actual === null || actual === '';
    case 'eq':
      return asComparable(actual) === asComparable(expected) || actual === expected;
    case 'neq':
      return !(asComparable(actual) === asComparable(expected) || actual === expected);
    case 'in':
      return Array.isArray(expected) && expected.some((e) => asComparable(e) === asComparable(actual));
    case 'notIn':
      return Array.isArray(expected) && !expected.some((e) => asComparable(e) === asComparable(actual));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => asComparable(a) === asComparable(expected));
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    default: {
      const a = asComparable(actual);
      const b = asComparable(expected);
      if (a === undefined || b === undefined || typeof a !== typeof b) return false;
      if (condition.op === 'gt') return a > b;
      if (condition.op === 'gte') return a >= b;
      if (condition.op === 'lt') return a < b;
      return a <= b;
    }
  }
}
