import { getPath } from '@universal-booking/core';

// ---------------------------------------------------------------------------
// Templates: {{path.to.value}} placeholders only; no logic, no code execution.
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderTemplate(template: string, vars: Record<string, unknown>, options: { html?: boolean } = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const v = getPath(vars, path);
    const s = v === undefined || v === null ? '' : String(v);
    return options.html ? escapeHtml(s) : s;
  });
}

/** Plain-text body to minimal, safe HTML (escaped, paragraphs, line breaks, linked URLs). */
export function textToHtml(text: string, brand?: { color?: string; name?: string }): string {
  const body = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + (brand?.color ?? '#2563eb') + '">$1</a>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">${body}</body></html>`;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

export interface SendResult {
  provider: string;
  messageId?: string;
}

export interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export interface SmsMessage {
  to: string;
  text: string;
}

export interface SmsProvider {
  name: string;
  send(message: SmsMessage): Promise<SendResult>;
}

type Log = (msg: string, data?: Record<string, unknown>) => void;

export function consoleEmail(log: Log = (m, d) => console.log(m, d ?? '')): EmailProvider {
  return {
    name: 'console',
    async send(m) {
      log(`[email] to=${m.to} subject="${m.subject}"`, { text: m.text });
      return { provider: 'console', messageId: `console-${Date.now()}` };
    },
  };
}

export function smtpEmail(url: string, defaultFrom: string): EmailProvider {
  let transport: import('nodemailer').Transporter | undefined;
  return {
    name: 'smtp',
    async send(m) {
      if (!transport) {
        const nodemailer = await import('nodemailer');
        transport = nodemailer.createTransport(url);
      }
      const info = await transport.sendMail({ from: m.from ?? defaultFrom, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo });
      return { provider: 'smtp', messageId: info.messageId };
    },
  };
}

export function resendEmail(apiKey: string, defaultFrom: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: 'resend',
    async send(m) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: m.from ?? defaultFrom, to: [m.to], subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${body.message ?? 'unknown'}`);
      return { provider: 'resend', messageId: body.id };
    },
  };
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export function consoleSms(log: Log = (m, d) => console.log(m, d ?? '')): SmsProvider {
  return {
    name: 'console',
    async send(m) {
      log(`[sms] to=${m.to}`, { text: m.text });
      return { provider: 'console' };
    },
  };
}

/** Semaphore (Philippines). */
export function semaphoreSms(apiKey: string, sender: string | undefined, fetchImpl: typeof fetch = fetch): SmsProvider {
  return {
    name: 'semaphore',
    async send(m) {
      const form = new URLSearchParams({ apikey: apiKey, number: m.to, message: m.text });
      if (sender) form.set('sendername', sender);
      const res = await fetchImpl('https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => [])) as { message_id?: number }[];
      if (!res.ok) throw new Error(`Semaphore error ${res.status}`);
      return { provider: 'semaphore', messageId: body[0]?.message_id ? String(body[0].message_id) : undefined };
    },
  };
}

export function twilioSms(accountSid: string, authToken: string, from: string, fetchImpl: typeof fetch = fetch): SmsProvider {
  return {
    name: 'twilio',
    async send(m) {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
        body: new URLSearchParams({ To: m.to, From: from, Body: m.text }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) throw new Error(`Twilio error ${res.status}: ${body.message ?? ''}`);
      return { provider: 'twilio', messageId: body.sid };
    },
  };
}

export interface NotificationConfig {
  EMAIL_DRIVER: 'console' | 'smtp' | 'resend';
  EMAIL_FROM: string;
  SMTP_URL?: string;
  RESEND_API_KEY?: string;
  SMS_DRIVER: 'console' | 'semaphore' | 'twilio';
  SEMAPHORE_API_KEY?: string;
  SEMAPHORE_SENDER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
}

export function createNotificationProviders(env: NotificationConfig, log?: Log): { email: EmailProvider; sms: SmsProvider } {
  const email =
    env.EMAIL_DRIVER === 'smtp' && env.SMTP_URL
      ? smtpEmail(env.SMTP_URL, env.EMAIL_FROM)
      : env.EMAIL_DRIVER === 'resend' && env.RESEND_API_KEY
        ? resendEmail(env.RESEND_API_KEY, env.EMAIL_FROM)
        : consoleEmail(log);
  const sms =
    env.SMS_DRIVER === 'semaphore' && env.SEMAPHORE_API_KEY
      ? semaphoreSms(env.SEMAPHORE_API_KEY, env.SEMAPHORE_SENDER)
      : env.SMS_DRIVER === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
        ? twilioSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM)
        : consoleSms(log);
  return { email, sms };
}
