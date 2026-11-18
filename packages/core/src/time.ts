import { DateTime, IANAZone } from 'luxon';

/** Half-open interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export interface WeeklyWindow {
  /** 0 = Sunday ... 6 = Saturday, in the business time zone. */
  dayOfWeek: number;
  /** "HH:mm" local time. */
  startTime: string;
  /** "HH:mm" local time. An end at or before the start runs past midnight. */
  endTime: string;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isLocalDate = (v: unknown): v is string => typeof v === 'string' && datePattern.test(v);
export const isLocalTime = (v: unknown): v is string => typeof v === 'string' && (timePattern.test(v) || v === '24:00');
export const isValidTimeZone = (tz: string): boolean => IANAZone.isValidZone(tz);

export const interval = (start: Date, end: Date): Interval => ({ start, end });

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start.getTime() <= inner.start.getTime() && outer.end.getTime() >= inner.end.getTime();
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start.getTime(), b.start.getTime());
  const end = Math.min(a.end.getTime(), b.end.getTime());
  return start < end ? { start: new Date(start), end: new Date(end) } : null;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.start < i.end).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

export function intersectAll(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of mergeIntervals(a)) {
    for (const y of mergeIntervals(b)) {
      const i = intersect(x, y);
      if (i) out.push(i);
    }
  }
  return mergeIntervals(out);
}

export function subtractIntervals(base: Interval[], remove: Interval[]): Interval[] {
  let result = mergeIntervals(base);
  for (const r of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (!overlaps(b, r)) {
        next.push(b);
        continue;
      }
      if (b.start < r.start) next.push({ start: b.start, end: r.start });
      if (b.end > r.end) next.push({ start: r.end, end: b.end });
    }
    result = next;
  }
  return result;
}

export function coveredBy(target: Interval, windows: Interval[]): boolean {
  return mergeIntervals(windows).some((w) => contains(w, target));
}

export const addMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

export function expand(i: Interval, beforeMinutes: number, afterMinutes: number): Interval {
  return { start: addMinutes(i.start, -beforeMinutes), end: addMinutes(i.end, afterMinutes) };
}

export const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Converts a local date and time in a time zone to an absolute instant. Times inside a DST gap move forward. */
export function zoned(date: string, time: string, tz: string): Date {
  if (time === '24:00') return DateTime.fromISO(date, { zone: tz }).plus({ days: 1 }).startOf('day').toJSDate();
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local date/time ${date} ${time} in ${tz}`);
  return dt.toJSDate();
}

export const startOfLocalDay = (date: string, tz: string): Date => DateTime.fromISO(date, { zone: tz }).startOf('day').toJSDate();

export const toLocalDate = (d: Date, tz: string): string => DateTime.fromJSDate(d, { zone: tz }).toISODate()!;

export const toLocalTime = (d: Date, tz: string): string => DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');

export const toLocalIso = (d: Date, tz: string): string => DateTime.fromJSDate(d, { zone: tz }).toISO({ suppressMilliseconds: true })!;

/** 0 = Sunday ... 6 = Saturday. */
export const dayOfWeek = (date: string): number => DateTime.fromISO(date).weekday % 7;

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export function daysBetween(startDate: string, endDate: string): number {
  return Math.round(DateTime.fromISO(endDate).diff(DateTime.fromISO(startDate), 'days').days);
}

/** Local dates from start (inclusive) to end (exclusive). */
export function eachDate(startDate: string, endDateExclusive: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  let guard = 0;
  while (cur < endDateExclusive && guard++ < 3700) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function localDayInterval(date: string, tz: string): Interval {
  return { start: startOfLocalDay(date, tz), end: startOfLocalDay(addDays(date, 1), tz) };
}

/** Materializes weekly windows for one local date, including windows that run past midnight. */
export function windowsForDate(windows: WeeklyWindow[], date: string, tz: string): Interval[] {
  const dow = dayOfWeek(date);
  const out: Interval[] = [];
  for (const w of windows) {
    if (w.dayOfWeek !== dow) continue;
    const start = zoned(date, w.startTime, tz);
    const overnight = w.endTime !== '24:00' && w.endTime <= w.startTime;
    const end = overnight ? zoned(addDays(date, 1), w.endTime, tz) : zoned(date, w.endTime, tz);
    if (start < end) out.push({ start, end });
  }
  return mergeIntervals(out);
}

export function windowsForRange(windows: WeeklyWindow[], startDate: string, endDateExclusive: string, tz: string): Interval[] {
  return mergeIntervals(eachDate(addDays(startDate, -1), endDateExclusive).flatMap((d) => windowsForDate(windows, d, tz)));
}

export const toIso = (d: Date): string => d.toISOString();
