'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminGetList } from '@/lib/admin-api';
import { useAdminAuth } from '@/components/admin/AdminAuthProvider';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { PageHeader } from '@/components/admin/ui';
import { Button, Input } from '@/components/portal/ui';

function weekRange(anchor: Date) {
  const d = new Date(anchor);
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return {
    from: fmt(start),
    to: fmt(end),
    labels: Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      return x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }),
  };
}

export default function CalendarPage() {
  const { token } = useAdminAuth();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [weekStart, setWeekStart] = useState(() => new Date());
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const monthRange = useMemo(() => {
    const d = new Date(weekStart);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const fmt = (x: Date) => x.toISOString().slice(0, 10);
    const days = end.getDate();
    return {
      from: fmt(start),
      to: fmt(end),
      labels: Array.from({ length: days }, (_, i) => {
        const day = new Date(d.getFullYear(), d.getMonth(), i + 1);
        return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      }),
    };
  }, [weekStart]);

  const range = mode === 'week' ? weekRange(weekStart) : monthRange;

  useEffect(() => {
    if (!token) return;
    void adminGetList<Record<string, unknown>>(
      `/bookings?from=${range.from}&to=${range.to}&pageSize=${mode === 'month' ? 500 : 200}`,
      token,
    ).then(setRows);
  }, [token, range.from, range.to, mode]);

  const byDay = useMemo(() => {
    const map: Record<number, Record<string, unknown>[]> = {};
    for (let i = 0; i < range.labels.length; i++) map[i] = [];
    for (const r of rows) {
      const d = String(r.startAt ?? '').slice(0, 10);
      const idx = range.labels.findIndex((_, i) => {
        const x = new Date(range.from);
        x.setDate(x.getDate() + i);
        return x.toISOString().slice(0, 10) === d;
      });
      if (idx >= 0) map[idx].push(r);
    }
    return map;
  }, [rows, range]);

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <>
            <button type="button" className={mode === 'week' ? 'portal-btn' : 'link-btn'} onClick={() => setMode('week')}>
              Week
            </button>
            <button type="button" className={mode === 'month' ? 'portal-btn' : 'link-btn'} onClick={() => setMode('month')}>
              Month
            </button>
            <Input type="date" value={weekStart.toISOString().slice(0, 10)} onChange={(e) => setWeekStart(new Date(e.target.value))} />
          </>
        }
      />
      <div className="calendar-week">
        {range.labels.map((label, i) => (
          <div key={label} className="calendar-day card">
            <h3>{label}</h3>
            <ul>
              {byDay[i].map((b) => (
                <li key={String(b.id)}>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setSelectedId(String(b.id));
                      setDrawerOpen(true);
                    }}
                  >
                    {String(b.reference ?? b.id).slice(0, 12)} · {String(b.status)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Button
        onClick={() =>
          setWeekStart((d) => {
            const n = new Date(d);
            if (mode === 'week') n.setDate(n.getDate() - 7);
            else n.setMonth(n.getMonth() - 1);
            return n;
          })
        }
      >
        {mode === 'week' ? 'Previous week' : 'Previous month'}
      </Button>
      <Button
        onClick={() =>
          setWeekStart((d) => {
            const n = new Date(d);
            if (mode === 'week') n.setDate(n.getDate() + 7);
            else n.setMonth(n.getMonth() + 1);
            return n;
          })
        }
      >
        {mode === 'week' ? 'Next week' : 'Next month'}
      </Button>
      <BookingDrawer bookingId={selectedId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
