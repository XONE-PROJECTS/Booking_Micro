'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminGetList, adminPost } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { PageHeader } from '@/components/admin/ui';
import { Button, Field, Input } from '@/components/portal/ui';

const STEPS = [
  'Service',
  'Booking model',
  'Date & time',
  'Resources',
  'Capacity',
  'Pricing',
  'Customer form',
  'Workflow',
  'Policies',
  'Preview & publish',
] as const;

type Versioned = { id: string; name?: string; version?: number; status?: string };

type DefState = {
  dateSelection: 'single' | 'range' | 'recurring';
  timeSelection: 'slot' | 'duration' | 'none';
  inventoryStrategy: 'exclusive' | 'pooled' | 'capacity';
  defaultDurationMinutes: string;
  minParticipants: string;
  maxParticipants: string;
};

export default function BuilderPage() {
  const { token } = useAdminAuth();
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [forms, setForms] = useState<Versioned[]>([]);
  const [workflows, setWorkflows] = useState<Versioned[]>([]);
  const [policies, setPolicies] = useState<Versioned[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [formId, setFormId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [resourceIds, setResourceIds] = useState('');
  const [def, setDef] = useState<DefState>({
    dateSelection: 'single',
    timeSelection: 'slot',
    inventoryStrategy: 'exclusive',
    defaultDurationMinutes: '60',
    minParticipants: '1',
    maxParticipants: '10',
  });
  const [basePrice, setBasePrice] = useState('0');
  const [preview, setPreview] = useState<unknown>(null);
  const [validation, setValidation] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void Promise.all([
      adminGetList<{ id: string; name: string }>('/services?pageSize=100', token),
      adminGetList<Versioned>('/forms?pageSize=50', token),
      adminGetList<Versioned>('/workflows?pageSize=50', token),
      adminGetList<Versioned>('/policies?pageSize=50', token),
    ]).then(([svc, f, w, p]) => {
      setServices(svc);
      setForms(f);
      setWorkflows(w);
      setPolicies(p);
    });
  }, [token]);

  const definition = useMemo(
    () => ({
      dateSelection: def.dateSelection,
      timeSelection: def.timeSelection,
      inventory: { strategy: def.inventoryStrategy },
      duration: { defaultMinutes: Number(def.defaultDurationMinutes) || 60 },
      participants: {
        min: Number(def.minParticipants) || 1,
        max: Number(def.maxParticipants) || 10,
      },
    }),
    [def],
  );

  const body = () => ({
    serviceId,
    workflowId: workflowId || undefined,
    formId: formId || undefined,
    policyId: policyId || undefined,
    definition,
    resourceIds: resourceIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    basePrice,
  });

  const previewSummary =
    preview && typeof preview === 'object' ? (
      <dl className="builder-preview-dl">
        {'service' in preview && preview.service && typeof preview.service === 'object' ? (
          <>
            <dt>Service</dt>
            <dd>{String((preview.service as { name?: string }).name ?? serviceId)}</dd>
          </>
        ) : null}
        {'checkout' in preview ? (
          <>
            <dt>Checkout steps</dt>
            <dd>{Array.isArray((preview as { checkout?: unknown }).checkout) ? (preview as { checkout: unknown[] }).checkout.length : '—'}</dd>
          </>
        ) : null}
      </dl>
    ) : null;

  return (
    <div>
      <PageHeader title="Custom booking builder" />
      <ol className="builder-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : ''}>
            <button type="button" onClick={() => setStep(i)}>
              {s}
            </button>
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <Field label="Service" id="svc">
          <select id="svc" className="portal-input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Select…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {step === 1 ? (
        <Field label="Inventory strategy" id="inv">
          <select id="inv" className="portal-input" value={def.inventoryStrategy} onChange={(e) => setDef((d) => ({ ...d, inventoryStrategy: e.target.value as DefState['inventoryStrategy'] }))}>
            <option value="exclusive">Exclusive</option>
            <option value="pooled">Pooled</option>
            <option value="capacity">Capacity</option>
          </select>
        </Field>
      ) : null}
      {step === 2 ? (
        <>
          <Field label="Date selection" id="ds">
            <select id="ds" className="portal-input" value={def.dateSelection} onChange={(e) => setDef((d) => ({ ...d, dateSelection: e.target.value as DefState['dateSelection'] }))}>
              <option value="single">Single date</option>
              <option value="range">Date range</option>
              <option value="recurring">Recurring</option>
            </select>
          </Field>
          <Field label="Time selection" id="ts">
            <select id="ts" className="portal-input" value={def.timeSelection} onChange={(e) => setDef((d) => ({ ...d, timeSelection: e.target.value as DefState['timeSelection'] }))}>
              <option value="slot">Time slots</option>
              <option value="duration">Fixed duration</option>
              <option value="none">No time picker</option>
            </select>
          </Field>
          <Field label="Default duration (minutes)" id="dur">
            <Input id="dur" type="number" value={def.defaultDurationMinutes} onChange={(e) => setDef((d) => ({ ...d, defaultDurationMinutes: e.target.value }))} />
          </Field>
        </>
      ) : null}
      {step === 3 ? (
        <Field label="Resource IDs (comma-separated)" id="res">
          <Input id="res" value={resourceIds} onChange={(e) => setResourceIds(e.target.value)} placeholder="uuid, uuid" />
        </Field>
      ) : null}
      {step === 4 ? (
        <>
          <Field label="Min participants" id="minp">
            <Input id="minp" type="number" value={def.minParticipants} onChange={(e) => setDef((d) => ({ ...d, minParticipants: e.target.value }))} />
          </Field>
          <Field label="Max participants" id="maxp">
            <Input id="maxp" type="number" value={def.maxParticipants} onChange={(e) => setDef((d) => ({ ...d, maxParticipants: e.target.value }))} />
          </Field>
        </>
      ) : null}
      {step === 5 ? (
        <Field label="Base price" id="bp">
          <Input id="bp" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
        </Field>
      ) : null}
      {step === 6 ? (
        <Field label="Published form" id="fid">
          <select id="fid" className="portal-input" value={formId} onChange={(e) => setFormId(e.target.value)}>
            <option value="">Select…</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name ?? f.id} {f.version ? `(v${f.version})` : ''}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {step === 7 ? (
        <Field label="Published workflow" id="wid">
          <select id="wid" className="portal-input" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
            <option value="">Select…</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name ?? w.id}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {step === 8 ? (
        <Field label="Published policy" id="pid">
          <select id="pid" className="portal-input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            <option value="">Select…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {step === 9 ? (
        <div className="admin-actions">
          <Button
            onClick={() =>
              token &&
              void adminPost('/config/preview', body(), token)
                .then(setPreview)
                .catch((e) => setMsg(String(e)))
            }
          >
            Live preview
          </Button>
          <Button
            onClick={() =>
              token &&
              void adminPost('/config/builder/validate', body(), token)
                .then(setValidation)
                .catch((e) => setMsg(String(e)))
            }
          >
            Validate
          </Button>
          <Button
            onClick={() =>
              token &&
              void adminPost('/config/builder/publish', body(), token)
                .then(() => setMsg('Published'))
                .catch((e) => setMsg(String(e)))
            }
          >
            Publish
          </Button>
        </div>
      ) : null}
      <div className="admin-actions">
        <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </Button>
        <Button disabled={step >= STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
          Next
        </Button>
      </div>
      {previewSummary}
      <pre className="card">{JSON.stringify(preview ?? validation ?? definition, null, 2)}</pre>
      {msg ? <p role="status">{msg}</p> : null}
    </div>
  );
}