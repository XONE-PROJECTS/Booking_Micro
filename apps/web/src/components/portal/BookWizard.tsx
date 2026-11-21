'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { postBookingCompleted } from '@/lib/embed-post';
import type { FormSchema, PublicService } from '@/lib/portal-api';
import { DynamicForm } from './DynamicForm';
import { Alert, Button, Field, Input, Stepper } from './ui';

type Slot = { start: string; localStart: string; available: boolean };
type QuoteLine = { label: string; amount: string };
type Quote = {
  available: boolean;
  pricing: { total: string; lines?: QuoteLine[]; amountDueNow?: string; amountDueLater?: string };
};

type StepKey = 'when' | 'time' | 'recurrence' | 'options' | 'guests' | 'form' | 'review' | 'pay';

export function BookWizard({
  businessSlug,
  serviceSlug,
  embedAllowedOrigins,
  compact,
  basePath,
}: {
  businessSlug: string;
  serviceSlug: string;
  embedAllowedOrigins?: string[];
  compact?: boolean;
  basePath?: string;
}) {
  const portalBase = basePath ?? `/${businessSlug}`;
  const t = useTranslations('portal');
  const router = useRouter();
  const [service, setService] = useState<PublicService | null>(null);
  const [form, setForm] = useState<FormSchema | null>(null);
  const [step, setStep] = useState(0);
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurrenceFreq, setRecurrenceFreq] = useState<'weekly' | 'daily' | 'monthly'>('weekly');
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [optionQty, setOptionQty] = useState<Record<string, number>>({});
  const [participants, setParticipants] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);

  const def = service?.definition;
  const slotMode = def?.timeSelection === 'slot';
  const rangeMode = def?.dateSelection === 'range';
  const recurringMode = def?.dateSelection === 'recurring';
  const guestTypes = def?.guests?.enabled ? (def.guests.types ?? []) : [];
  const hasOptions = (service?.options?.length ?? 0) > 0;

  const steps = useMemo((): StepKey[] => {
    const s: StepKey[] = ['when'];
    if (recurringMode) s.push('recurrence');
    if (slotMode) s.push('time');
    if (hasOptions) s.push('options');
    if (guestTypes.length) s.push('guests');
    s.push('form', 'review');
    return s;
  }, [recurringMode, slotMode, hasOptions, guestTypes.length]);

  const payAfterBook = useMemo(() => {
    const due = quote?.pricing.amountDueNow;
    return due != null && Number(due) > 0;
  }, [quote]);

  const stepLabels: Record<StepKey, string> = {
    when: t('when'),
    time: t('time'),
    recurrence: 'Schedule',
    options: 'Options',
    guests: 'Guests',
    form: 'Details',
    review: t('review'),
    pay: 'Payment',
  };

  const currentKey = steps[step] ?? 'review';

  useEffect(() => {
    void Promise.all([
      apiGet<PublicService>(`/public/${businessSlug}/services/${serviceSlug}`).then((svc) => {
        setService(svc);
        const init: Record<string, number> = {};
        for (const gt of svc.definition?.guests?.types ?? []) init[gt.key] = gt.min ?? 1;
        setParticipants(init);
        const oinit: Record<string, number> = {};
        for (const o of svc.options ?? []) if (o.required) oinit[o.id] = 1;
        setOptionQty(oinit);
      }),
      apiGet<{ schema: FormSchema }>(`/public/${businessSlug}/services/${serviceSlug}/form`).then((f) => setForm(f.schema)),
    ]).catch(() => setError(t('error')));
  }, [businessSlug, serviceSlug, t]);

  const quoteBody = useCallback((): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      serviceSlug,
      startDate: date,
      quantity,
      promoCode: promo || undefined,
      participants: Object.keys(participants).length ? participants : undefined,
      options: Object.entries(optionQty)
        .filter(([, q]) => q > 0)
        .map(([id, quantity]) => ({ id, quantity })),
    };
    if (endDate && rangeMode) body.endDate = endDate;
    if (slot) body.startAt = slot.start;
    if (recurringMode) body.recurrence = { frequency: recurrenceFreq, interval: 1, count: recurrenceCount };
    return body;
  }, [
    date,
    endDate,
    optionQty,
    participants,
    promo,
    quantity,
    rangeMode,
    recurringMode,
    recurrenceCount,
    recurrenceFreq,
    serviceSlug,
    slot,
  ]);

  const loadSlots = useCallback(async () => {
    if (!service || !date) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ serviceId: service.id, date, quantity: String(quantity) });
      const rows = await apiGet<Slot[]>(`/public/${businessSlug}/availability/slots?${q}`);
      setSlots(rows.filter((s) => s.available));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }, [businessSlug, date, quantity, service, t]);

  const loadQuote = useCallback(async (): Promise<boolean> => {
    if (!service) return false;
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<Quote>(`/public/${businessSlug}/pricing/quote`, quoteBody());
      setQuote(data);
      if (!data.available) {
        setError('Not available for this selection.');
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [businessSlug, quoteBody, service, t]);

  const submit = async () => {
    if (!service || !quote?.available) return;
    setBusy(true);
    try {
      const idem = crypto.randomUUID();
      const body = {
        ...quoteBody(),
        customer,
        answers,
        termsAccepted: terms,
      };
      const data = await apiPost<{ id: string; reference: string; accessToken?: string; pricing?: { amountDueNow?: string } }>(
        `/public/${businessSlug}/bookings`,
        body,
        idem,
      );
      postBookingCompleted(embedAllowedOrigins, data);
      const due = data.pricing?.amountDueNow ?? quote.pricing.amountDueNow;
      if (due && Number(due) > 0) {
        const confirmParams = new URLSearchParams({ reference: data.reference });
        if (data.accessToken) confirmParams.set('token', data.accessToken);
        const checkout = await apiPost<{ checkoutUrl?: string | null }>(`/public/${businessSlug}/bookings/${data.id}/checkout`, {
          successUrl: `${window.location.origin}${portalBase}/booking/confirmation?${confirmParams}`,
          cancelUrl: window.location.href,
        });
        if (checkout.checkoutUrl) {
          window.location.href = checkout.checkoutUrl;
          return;
        }
      }
      const q = new URLSearchParams({ reference: data.reference });
      if (data.accessToken) q.set('token', data.accessToken);
      router.push(`${portalBase}/booking/confirmation?${q}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    const key = steps[step];
    if (key === 'when' && slotMode) await loadSlots();
    if (key === 'form') {
      const ok = await loadQuote();
      if (!ok) return;
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const back = () => setStep(Math.max(0, step - 1));

  if (!service) return <p>{t('loading')}</p>;

  const needsDate = !date || (rangeMode && !endDate);

  return (
    <article className={compact ? 'embed-wizard' : undefined}>
      <h1>{service.name}</h1>
      <Stepper step={step} total={steps.length} />
      <p className="portal-muted" aria-live="polite">
        Step {step + 1}: {stepLabels[currentKey]}
      </p>

      {currentKey === 'when' && (
        <section className="card">
          <Field label={t('when')} id="book-date">
            <Input id="book-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {rangeMode ? (
            <Field label="Check-out" id="book-end">
              <Input id="book-end" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          ) : null}
          {!guestTypes.length ? (
            <Field label="Quantity" id="qty">
              <Input id="qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 1)} />
            </Field>
          ) : null}
          <Button disabled={needsDate || busy} onClick={() => void next()}>
            {t('next')}
          </Button>
        </section>
      )}

      {currentKey === 'recurrence' && (
        <section className="card">
          <Field label="Frequency" id="freq">
            <select
              id="freq"
              className="portal-input"
              value={recurrenceFreq}
              onChange={(e) => setRecurrenceFreq(e.target.value as typeof recurrenceFreq)}
            >
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Number of occurrences" id="rc">
            <Input
              id="rc"
              type="number"
              min={2}
              max={104}
              value={recurrenceCount}
              onChange={(e) => setRecurrenceCount(Number(e.target.value) || 2)}
            />
          </Field>
          <Button onClick={() => void next()}>{t('next')}</Button>
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {currentKey === 'time' && (
        <section className="card">
          <p>{t('time')}</p>
          <ul className="slot-list">
            {slots.map((s) => (
              <li key={s.start}>
                <button type="button" className={slot?.start === s.start ? 'slot active' : 'slot'} onClick={() => setSlot(s)}>
                  {s.localStart}
                </button>
              </li>
            ))}
          </ul>
          <Button disabled={!slot} onClick={() => void next()}>
            {t('next')}
          </Button>
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {currentKey === 'options' && (
        <section className="card">
          <ul className="option-list">
            {(service.options ?? []).map((o) => (
              <li key={o.id}>
                <label>
                  {o.name} ({o.price})
                  <Input
                    type="number"
                    min={o.required ? 1 : 0}
                    max={o.maxQuantity ?? 99}
                    value={optionQty[o.id] ?? 0}
                    onChange={(e) => setOptionQty((prev) => ({ ...prev, [o.id]: Number(e.target.value) || 0 }))}
                  />
                </label>
              </li>
            ))}
          </ul>
          <Button onClick={() => void next()}>{t('next')}</Button>
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {currentKey === 'guests' && (
        <section className="card">
          {guestTypes.map((g) => (
            <Field key={g.key} label={g.label} id={`g-${g.key}`}>
              <Input
                id={`g-${g.key}`}
                type="number"
                min={g.min ?? 0}
                max={g.max ?? 100}
                value={participants[g.key] ?? 0}
                onChange={(e) => setParticipants((p) => ({ ...p, [g.key]: Number(e.target.value) || 0 }))}
              />
            </Field>
          ))}
          <Button onClick={() => void next()}>{t('next')}</Button>
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {currentKey === 'form' && (
        <section className="card">
          <Field label="Promo code" id="promo">
            <Input id="promo" value={promo} onChange={(e) => setPromo(e.target.value)} />
          </Field>
          {form ? <DynamicForm schema={form} values={answers} onChange={setAnswers} /> : null}
          <Button disabled={busy} onClick={() => void next()}>
            {t('next')}
          </Button>
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {currentKey === 'review' && quote && (
        <section className="card">
          <h2>{t('review')}</h2>
          {!quote.available ? <p>Unavailable</p> : null}
          <ul className="quote-lines" aria-label="Price breakdown">
            {(quote.pricing.lines ?? []).map((line, i) => (
              <li key={i}>
                <span>{line.label}</span>
                <span>{line.amount}</span>
              </li>
            ))}
            <li>
              <strong>Total</strong>
              <strong>{quote.pricing.total}</strong>
            </li>
            {quote.pricing.amountDueNow ? (
              <li>
                <span>Due now</span>
                <span>{quote.pricing.amountDueNow}</span>
              </li>
            ) : null}
          </ul>
          <Field label={t('details')} id="cust-fn">
            <Input
              id="cust-fn"
              placeholder="First name"
              value={customer.firstName}
              onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })}
              required
            />
          </Field>
          <Input
            aria-label="Last name"
            placeholder="Last name"
            value={customer.lastName}
            onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })}
          />
          <Input
            aria-label="Email"
            type="email"
            value={customer.email}
            onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
            required
          />
          <Input
            aria-label="Phone"
            type="tel"
            value={customer.phone}
            onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
          />
          <label>
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required /> {t('terms')}
          </label>
          {payAfterBook ? (
            <>
              <p>After you confirm, you will be redirected to complete payment of {quote.pricing.amountDueNow}.</p>
              <Button disabled={!terms || !quote.available || busy} onClick={() => void submit()}>
                Confirm &amp; pay
              </Button>
            </>
          ) : (
            <Button disabled={!terms || !quote.available || busy} onClick={() => void submit()}>
              {t('confirm')}
            </Button>
          )}
          <Button onClick={back}>{t('back')}</Button>
        </section>
      )}

      {error ? <Alert>{error}</Alert> : null}
    </article>
  );
}
