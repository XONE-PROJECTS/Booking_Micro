'use client';

import type { FormSchema } from '@/lib/portal-api';
import { Field, Input } from './ui';

export function DynamicForm({
  schema,
  values,
  onChange,
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (!schema.fields?.length) return null;
  return (
    <fieldset className="card">
      <legend>Additional information</legend>
      {schema.fields.map((f) => {
        const id = `field-${f.key}`;
        if (f.type === 'consent') {
          return (
            <Field key={f.key} label={f.label} id={id}>
              <label>
                <input
                  type="checkbox"
                  id={id}
                  checked={!!values[f.key]}
                  required={f.required}
                  onChange={(e) => onChange({ ...values, [f.key]: e.target.checked })}
                />
                {f.consentText ?? f.label}
              </label>
            </Field>
          );
        }
        if (f.type === 'select' && f.options) {
          return (
            <Field key={f.key} label={f.label} id={id}>
              <select
                id={id}
                className="portal-input"
                required={f.required}
                value={String(values[f.key] ?? '')}
                onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              >
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          );
        }
        const type = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text';
        return (
          <Field key={f.key} label={f.label} id={id}>
            <Input
              id={id}
              type={type}
              required={f.required}
              placeholder={f.placeholder}
              value={String(values[f.key] ?? '')}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
          </Field>
        );
      })}
    </fieldset>
  );
}