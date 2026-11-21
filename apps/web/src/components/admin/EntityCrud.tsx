'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminDelete, adminGetList, adminPatch, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { Button, Field, Input } from '@/components/portal/ui';
import { DataTable, FilterBar, PageHeader, SideDrawer } from '@/components/admin/ui';

export type CrudFieldType = 'text' | 'number' | 'boolean' | 'select' | 'date' | 'datetime' | 'textarea' | 'service' | 'json';

export type CrudField = {
  key: string;
  label: string;
  type?: CrudFieldType;
  options?: { value: string; label: string }[];
  optional?: boolean;
  showInTable?: boolean;
  rows?: number;
};

export type CrudSection = {
  key: string;
  label: string;
  path: string;
  fields: CrudField[];
  defaults: Record<string, unknown>;
  allowUpdate?: boolean;
};

function fieldToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function buildPayload(fields: CrudField[], form: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = form[f.key]?.trim() ?? '';
    if (!raw && f.optional) continue;
    switch (f.type) {
      case 'number':
        body[f.key] = raw === '' ? undefined : Number(raw);
        break;
      case 'boolean':
        body[f.key] = raw === 'true' || raw === 'on';
        break;
      case 'json':
        try {
          body[f.key] = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`Invalid JSON in ${f.label}`);
        }
        break;
      case 'service':
        if (raw) body[f.key] = raw;
        break;
      case 'datetime':
        if (raw) body[f.key] = new Date(raw).toISOString();
        break;
      default:
        if (raw) body[f.key] = raw;
        else if (!f.optional) body[f.key] = raw;
    }
  }
  return body;
}

function formFromRow(fields: CrudField[], row: Record<string, unknown>): Record<string, string> {
  const form: Record<string, string> = {};
  for (const f of fields) {
    form[f.key] = fieldToString(row[f.key]);
  }
  return form;
}

function emptyForm(fields: CrudField[], defaults: Record<string, unknown>): Record<string, string> {
  const form: Record<string, string> = {};
  for (const f of fields) {
    const d = defaults[f.key];
    form[f.key] = d !== undefined ? fieldToString(d) : '';
  }
  return form;
}

function FieldInput({
  field,
  value,
  onChange,
  services,
}: {
  field: CrudField;
  value: string;
  onChange: (v: string) => void;
  services: { id: string; name: string }[];
}) {
  const id = `crud-${field.key}`;
  if (field.type === 'boolean') {
    return (
      <label className="portal-field" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} /> {field.label}
      </label>
    );
  }
  if (field.type === 'select' && field.options) {
    return (
      <Field label={field.label} id={id}>
        <select id={id} className="portal-input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (field.type === 'service') {
    return (
      <Field label={field.label} id={id}>
        <select id={id} className="portal-input" value={value} onChange={(e) => onChange(e.target.value)} required={!field.optional}>
          <option value="">Select service…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (field.type === 'textarea' || field.type === 'json') {
    return (
      <Field label={field.label} id={id}>
        <textarea
          id={id}
          className={`portal-input json-editor`}
          rows={field.rows ?? (field.type === 'json' ? 6 : 3)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return (
    <Field label={field.label} id={id}>
      <Input id={id} type={inputType} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

type Props = { title: string; sections: CrudSection[]; hideSectionTabs?: boolean };

export function EntityCrud({ title, sections, hideSectionTabs }: Props) {
  const { token } = useAdminAuth();
  const [sectionKey, setSectionKey] = useState(sections[0]!.key);
  const section = sections.find((s) => s.key === sectionKey) ?? sections[0]!;
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [createForm, setCreateForm] = useState<Record<string, string>>(() => emptyForm(section.fields, section.defaults));
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    void adminGetList(`${section.path}?pageSize=100`, token).then(setRows).catch(() => setRows([]));
  }, [token, section.path]);

  useEffect(() => {
    if (!token) return;
    void adminGetList<{ id: string; name: string }>('/services?pageSize=100', token).then(setServices).catch(() => setServices([]));
  }, [token]);

  useEffect(() => {
    setCreateForm(emptyForm(section.fields, section.defaults));
    setEditRow(null);
    load();
  }, [sectionKey, load, section.fields, section.defaults]);

  const tableCols = section.fields.filter((f) => f.showInTable !== false).slice(0, 6);

  async function create() {
    if (!token) return;
    setMsg(null);
    try {
      const body = { ...section.defaults, ...buildPayload(section.fields, createForm) };
      await adminPost(section.path, body, token);
      setCreateForm(emptyForm(section.fields, section.defaults));
      setMsg('Created');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function saveEdit() {
    if (!token || !editRow?.id) return;
    setMsg(null);
    try {
      const body = buildPayload(section.fields, editForm);
      await adminPatch(`${section.path}/${String(editRow.id)}`, body, token);
      setEditRow(null);
      setMsg('Updated');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function remove(id: string) {
    if (!token || !confirm('Delete this record?')) return;
    try {
      await adminDelete(`${section.path}/${id}`, token);
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <PageHeader title={title} />
      {hideSectionTabs && sections.length <= 1 ? null : (
        <div className="admin-actions" role="tablist" aria-label="Sections">
          {sections.map((s) => (
            <button key={s.key} type="button" role="tab" aria-selected={s.key === sectionKey} className={s.key === sectionKey ? 'portal-btn' : 'link-btn'} onClick={() => setSectionKey(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <FilterBar>
        {section.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={createForm[f.key] ?? ''}
            onChange={(v) => setCreateForm((prev) => ({ ...prev, [f.key]: v }))}
            services={services}
          />
        ))}
        <Button onClick={() => void create()}>Add {section.label.toLowerCase()}</Button>
      </FilterBar>
      {msg ? <p role="status">{msg}</p> : null}
      <DataTable
        columns={[
          ...tableCols.map((f) => ({ key: f.key, label: f.label })),
          {
            key: 'actions',
            label: 'Actions',
            render: (r) => (
              <>
                {section.allowUpdate !== false ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditRow(r);
                      setEditForm(formFromRow(section.fields, r));
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); void remove(String(r.id)); }}>
                  Delete
                </button>
              </>
            ),
          },
        ]}
        rows={rows}
        onRowClick={section.allowUpdate !== false ? (r) => { setEditRow(r); setEditForm(formFromRow(section.fields, r)); } : undefined}
      />
      <SideDrawer open={!!editRow} onClose={() => setEditRow(null)} title={`Edit ${section.label.toLowerCase()}`}>
        {section.fields.map((f) => (
          <FieldInput key={f.key} field={f} value={editForm[f.key] ?? ''} onChange={(v) => setEditForm((prev) => ({ ...prev, [f.key]: v }))} services={services} />
        ))}
        <div className="admin-actions">
          <Button onClick={() => void saveEdit()}>Save</Button>
          <Button onClick={() => setEditRow(null)}>Cancel</Button>
        </div>
      </SideDrawer>
    </div>
  );
}