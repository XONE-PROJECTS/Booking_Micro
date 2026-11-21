const MSG = 'universal-booking:booking.completed';

/** Posts a booking-completed event to the parent frame using tenant allowlist or document.referrer origin. */
export function postBookingCompleted(allowedOrigins: string[] | undefined, payload: unknown) {
  if (typeof window === 'undefined' || window.parent === window) return;
  const msg = { type: MSG, payload };
  const allow = new Set((allowedOrigins ?? []).map((o) => o.replace(/\/$/, '')));
  let target: string | null = null;
  try {
    if (document.referrer) target = new URL(document.referrer).origin;
  } catch {
    /* ignore bad referrer */
  }
  if (target && (allow.size === 0 || allow.has(target))) {
    window.parent.postMessage(msg, target);
    return;
  }
  for (const o of allow) window.parent.postMessage(msg, o);
}