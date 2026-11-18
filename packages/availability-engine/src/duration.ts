import { DateTime } from 'luxon';
import {
  addDays,
  daysBetween,
  eachDate,
  errors,
  isLocalDate,
  isLocalTime,
  toLocalDate,
  zoned,
  addMinutes,
  type BookingDefinition,
  type ErrorDetail,
  type Interval,
} from '@universal-booking/core';
import type { AvailabilityRequest, DurationResult, RecurrenceInput } from './types';

function fail(message: string, path?: string): never {
  const details: ErrorDetail[] = [{ message, path }];
  throw errors.validation(message, details);
}

/** Length in minutes of one timed booking, honoring fixed or customer-selected durations. */
export function timedDurationMinutes(def: BookingDefinition, requested?: number): number {
  const d = def.duration;
  if (d.mode === 'fixed') {
    if (!d.minutes) fail('The booking definition has no fixed duration.', 'duration.minutes');
    return d.minutes;
  }
  if (requested === undefined) fail('A duration is required for this service.', 'durationMinutes');
  const unitMinutes = d.unit === 'hours' ? 60 : d.unit === 'days' ? 1440 : 1;
  const step = d.stepMinutes ?? unitMinutes;
  if (requested % step !== 0) fail(`Duration must be a multiple of ${step} minutes.`, 'durationMinutes');
  if (d.min !== undefined && requested < d.min * unitMinutes) fail(`Duration must be at least ${d.min} ${d.unit}.`, 'durationMinutes');
  if (d.max !== undefined && requested > d.max * unitMinutes) fail(`Duration must be at most ${d.max} ${d.unit}.`, 'durationMinutes');
  return requested;
}

export function expandRecurrence(first: Interval, recurrence: RecurrenceInput, tz: string): Interval[] {
  const step = Math.max(1, recurrence.interval ?? 1);
  const out: Interval[] = [];
  const start = DateTime.fromJSDate(first.start, { zone: tz });
  const lengthMs = first.end.getTime() - first.start.getTime();
  for (let i = 0; i < recurrence.count; i++) {
    const unit = recurrence.frequency === 'daily' ? 'days' : recurrence.frequency === 'weekly' ? 'weeks' : 'months';
    // Advancing in local time keeps the wall-clock time stable across daylight-saving changes.
    const s = start.plus({ [unit]: i * step }).toJSDate();
    out.push({ start: s, end: new Date(s.getTime() + lengthMs) });
  }
  return out;
}

/** Turns a request into concrete booked periods and billing units for the definition's strategy. */
export function resolveDuration(def: BookingDefinition, req: AvailabilityRequest, tz: string): DurationResult {
  let periods: Interval[];
  let minutes = 0;
  let days = 0;
  let nights = 0;
  let dates: string[] = [];

  if (def.timeSelection === 'none' && def.dateSelection === 'range') {
    if (!isLocalDate(req.startDate)) fail('startDate (YYYY-MM-DD) is required.', 'startDate');
    const endDate = req.endDate ?? (def.duration.unit === 'nights' ? addDays(req.startDate, 1) : req.startDate);
    if (!isLocalDate(endDate)) fail('endDate must be YYYY-MM-DD.', 'endDate');
    if (def.duration.unit === 'nights') {
      // Check-in date included, check-out date excluded; local-midnight boundaries allow same-day turnover.
      nights = daysBetween(req.startDate, endDate);
      if (nights < 1) fail('The check-out date must be after the check-in date.', 'endDate');
      periods = [{ start: zoned(req.startDate, '00:00', tz), end: zoned(endDate, '00:00', tz) }];
      dates = eachDate(req.startDate, endDate);
      days = nights;
    } else {
      if (endDate < req.startDate) fail('The end date must not be before the start date.', 'endDate');
      days = daysBetween(req.startDate, endDate) + 1;
      periods = [{ start: zoned(req.startDate, '00:00', tz), end: zoned(addDays(endDate, 1), '00:00', tz) }];
      dates = eachDate(req.startDate, addDays(endDate, 1));
    }
    const count = def.duration.unit === 'nights' ? nights : days;
    if (def.duration.min !== undefined && count < def.duration.min) fail(`Minimum is ${def.duration.min} ${def.duration.unit}.`, 'endDate');
    if (def.duration.max !== undefined && count > def.duration.max) fail(`Maximum is ${def.duration.max} ${def.duration.unit}.`, 'endDate');
    minutes = Math.round((periods[0]!.end.getTime() - periods[0]!.start.getTime()) / 60_000);
  } else if (def.timeSelection === 'none') {
    if (!isLocalDate(req.startDate)) fail('startDate (YYYY-MM-DD) is required.', 'startDate');
    periods = [{ start: zoned(req.startDate, '00:00', tz), end: zoned(addDays(req.startDate, 1), '00:00', tz) }];
    dates = [req.startDate];
    days = 1;
    minutes = 1440;
  } else {
    let start: Date;
    if (req.startAt) {
      const parsed = new Date(req.startAt);
      if (Number.isNaN(parsed.getTime())) fail('startAt must be an ISO date-time.', 'startAt');
      start = parsed;
    } else {
      if (!isLocalDate(req.startDate)) fail('startDate (YYYY-MM-DD) is required.', 'startDate');
      if (!isLocalTime(req.startTime)) fail('startTime (HH:mm) is required.', 'startTime');
      start = zoned(req.startDate, req.startTime, tz);
    }
    minutes = timedDurationMinutes(def, req.durationMinutes);
    periods = [{ start, end: addMinutes(start, minutes) }];
    dates = [toLocalDate(start, tz)];
    days = Math.max(1, Math.ceil(minutes / 1440));
  }

  if (req.recurrence) {
    if (!def.recurrence.enabled && def.dateSelection !== 'recurring') fail('This service does not allow recurring bookings.', 'recurrence');
    if (!def.recurrence.frequencies.includes(req.recurrence.frequency)) fail(`Frequency "${req.recurrence.frequency}" is not allowed.`, 'recurrence.frequency');
    if (req.recurrence.count < 1 || req.recurrence.count > def.recurrence.maxOccurrences) {
      fail(`Recurring bookings allow 1 to ${def.recurrence.maxOccurrences} occurrences.`, 'recurrence.count');
    }
    periods = expandRecurrence(periods[0]!, req.recurrence, tz);
    dates = periods.flatMap((p) => (def.timeSelection === 'none' ? eachDate(toLocalDate(p.start, tz), toLocalDate(p.end, tz)) : [toLocalDate(p.start, tz)]));
  } else if (def.dateSelection === 'recurring') {
    fail('A recurrence rule is required for this service.', 'recurrence');
  }

  return {
    periods,
    units: { minutes, hours: minutes / 60, days, nights, sessions: periods.length },
    dates,
  };
}
