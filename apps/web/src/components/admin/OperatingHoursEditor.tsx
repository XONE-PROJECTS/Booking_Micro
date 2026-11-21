'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminPut } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { Button, Field, Input } from '@/components/portal/ui';
import { DataTable, FilterBar } from '@/components/admin/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type HourRow = { dayOfWeek: number; startTime: string; endTime: string; label?: string };

export function OperatingHoursEditor() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<HourRow[]>([]);
  const [draft, setDraft] = useState<HourRow>({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    void adminGet<HourRow[]>('/availability/operating-hours', token)
      .then((list) => setRows(list.map((r) => ({ dayOfWeek: Number(r.dayOfWeek), startTime: String(r.startTime), endTime: String(r.endTime), label: r.label ? String(r.label) : undefined }))))
      .catch(() => setRows([]));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function addRow() {
    setRows((prev) => [...prev.filter((r) => !(r.dayOfWeek === draft.dayOfWeek && r.startTime === draft.startTime)), draft]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!token) return;
    setMsg(null);
    try {
      await adminPut('/availability/operating-hours', { hours: rows }, token);
      setMsg('Operating hours saved');
      load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <section className="operating-hours">
      <FilterBar>
        <Field label="Day" id="oh-day">
          <select id="oh-day" className="portal-input" value={draft.dayOfWeek} onChange={(e) => setDraft((d) => ({ ...d, dayOfWeek: Number(e.target.value) }))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start" id="oh-start">
          <Input id="oh-start" value={draft.startTime} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))} />
        </Field>
        <Field label="End" id="oh-end">
          <Input id="oh-end" value={draft.endTime} onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))} />
        </Field>
        <Field label="Label" id="oh-label">
          <Input id="oh-label" value={draft.label ?? ''} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value || undefined }))} />
        </Field>
        <Button onClick={addRow}>Add window</Button>
        <Button onClick={() => void save()}>Save all hours</Button>
      </FilterBar>
      {msg ? <p role="status">{msg}</p> : null}
      <DataTable
        columns={[
          { key: 'dayOfWeek', label: 'Day', render: (r) => DAYS[Number(r.dayOfWeek)] ?? String(r.dayOfWeek) },
          { key: 'startTime', label: 'Start' },
          { key: 'endTime', label: 'End' },
          { key: 'label', label: 'Label' },
          {
            key: 'actions',
            label: '',
            render: (r) => (
              <button type="button" className="link-btn" onClick={() => removeRow(Number(r.id))}>
                Remove
              </button>
            ),
          },
        ]}
        rows={rows.map((r, i) => ({ ...r, id: i }))}
      />
    </section>
  );
}