import { z } from 'zod';
import { conditionSchema, evaluateCondition, type Condition } from './conditions';
import type { ErrorDetail } from './errors';

export const formFieldTypes = [
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'date',
  'time',
  'select',
  'multiselect',
  'radio',
  'checkboxes',
  'file',
  'daterange',
  'consent',
] as const;
export type FormFieldType = (typeof formFieldTypes)[number];

const optionSchema = z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) });

export const formFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field keys use lowercase letters, numbers and underscores'),
  type: z.enum(formFieldTypes),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  placeholder: z.string().max(200).optional(),
  instructions: z.string().max(1000).optional(),
  group: z.string().max(100).optional(),
  order: z.number().int().default(0),
  options: z.array(optionSchema).max(200).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).max(10_000).optional(),
      pattern: z.string().max(300).optional(),
      maxFiles: z.number().int().min(1).max(10).optional(),
      acceptedTypes: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
  visibleWhen: conditionSchema.optional(),
  /** Text shown next to consent checkboxes, versioned with the form. */
  consentText: z.string().max(5000).optional(),
});

export type FormField = z.infer<typeof formFieldSchema>;

export const formSchemaDefinition = z
  .object({
    fields: z.array(formFieldSchema).max(100),
    groups: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  })
  .superRefine((form, ctx) => {
    const keys = new Set<string>();
    form.fields.forEach((f, i) => {
      if (keys.has(f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `Duplicate field key "${f.key}"` });
      keys.add(f.key);
      if (['select', 'multiselect', 'radio', 'checkboxes'].includes(f.type) && !f.options?.length) {
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'options'], message: `Field "${f.key}" needs options` });
      }
      if (f.validation?.pattern) {
        try {
          new RegExp(f.validation.pattern);
        } catch {
          ctx.addIssue({ code: 'custom', path: ['fields', i, 'validation', 'pattern'], message: 'Invalid pattern' });
        }
      }
    });
  });

export type FormSchema = z.infer<typeof formSchemaDefinition>;

export interface FormValidationResult {
  valid: boolean;
  errors: ErrorDetail[];
  values: Record<string, unknown>;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRe = /^\+?[0-9 ()-]{6,20}$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const uuidRe = /^[0-9a-f-]{36}$/i;

export function isFieldVisible(field: FormField, answers: Record<string, unknown>): boolean {
  return evaluateCondition(field.visibleWhen as Condition | undefined, answers);
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;

/** Server-authoritative validation of a form submission; hidden fields are dropped. */
export function validateFormSubmission(form: FormSchema, raw: Record<string, unknown>): FormValidationResult {
  const errors: ErrorDetail[] = [];
  const values: Record<string, unknown> = {};
  const answers = { ...raw };
  for (const f of form.fields) if (answers[f.key] === undefined && f.defaultValue !== undefined) answers[f.key] = f.defaultValue;

  for (const field of [...form.fields].sort((a, b) => a.order - b.order)) {
    if (!isFieldVisible(field, answers)) continue;
    const value = answers[field.key];
    const path = `answers.${field.key}`;
    const fail = (message: string) => errors.push({ path, message, code: 'invalid_field' });

    if (isEmpty(value)) {
      if (field.required) fail(field.type === 'consent' ? `${field.label} must be accepted` : `${field.label} is required`);
      continue;
    }

    const v = field.validation ?? {};
    const optionValues = new Set((field.options ?? []).map((o) => o.value));
    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'phone': {
        if (typeof value !== 'string') {
          fail(`${field.label} must be text`);
          break;
        }
        const s = value.trim();
        if (field.type === 'email' && !emailRe.test(s)) fail(`${field.label} must be a valid email`);
        if (field.type === 'phone' && !phoneRe.test(s)) fail(`${field.label} must be a valid phone number`);
        if (v.minLength !== undefined && s.length < v.minLength) fail(`${field.label} must be at least ${v.minLength} characters`);
        const maxLength = v.maxLength ?? (field.type === 'textarea' ? 5000 : 500);
        if (s.length > maxLength) fail(`${field.label} must be at most ${maxLength} characters`);
        if (v.pattern && !new RegExp(v.pattern).test(s)) fail(`${field.label} has an invalid format`);
        values[field.key] = s;
        break;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          fail(`${field.label} must be a number`);
          break;
        }
        if (v.min !== undefined && n < v.min) fail(`${field.label} must be at least ${v.min}`);
        if (v.max !== undefined && n > v.max) fail(`${field.label} must be at most ${v.max}`);
        values[field.key] = n;
        break;
      }
      case 'date':
        if (typeof value !== 'string' || !dateRe.test(value)) fail(`${field.label} must be a date (YYYY-MM-DD)`);
        else values[field.key] = value;
        break;
      case 'time':
        if (typeof value !== 'string' || !timeRe.test(value)) fail(`${field.label} must be a time (HH:mm)`);
        else values[field.key] = value;
        break;
      case 'daterange': {
        const r = value as { start?: unknown; end?: unknown };
        if (!r || typeof r !== 'object' || typeof r.start !== 'string' || typeof r.end !== 'string' || !dateRe.test(r.start) || !dateRe.test(r.end) || r.end < r.start) {
          fail(`${field.label} must be a valid date range`);
        } else values[field.key] = { start: r.start, end: r.end };
        break;
      }
      case 'select':
      case 'radio':
        if (typeof value !== 'string' || !optionValues.has(value)) fail(`${field.label} has an invalid option`);
        else values[field.key] = value;
        break;
      case 'multiselect':
      case 'checkboxes': {
        const arr = Array.isArray(value) ? value : [value];
        if (!arr.every((x) => typeof x === 'string' && optionValues.has(x))) fail(`${field.label} has an invalid option`);
        else if (v.max !== undefined && arr.length > v.max) fail(`${field.label} allows at most ${v.max} choices`);
        else values[field.key] = arr;
        break;
      }
      case 'file': {
        const arr = Array.isArray(value) ? value : [value];
        if (!arr.every((x) => typeof x === 'string' && uuidRe.test(x))) fail(`${field.label} must reference uploaded files`);
        else if (arr.length > (v.maxFiles ?? 1)) fail(`${field.label} allows at most ${v.maxFiles ?? 1} files`);
        else values[field.key] = arr;
        break;
      }
      case 'consent':
        if (value !== true && value !== 'true') fail(`${field.label} must be accepted`);
        else values[field.key] = true;
        break;
    }
  }
  return { valid: errors.length === 0, errors, values };
}
