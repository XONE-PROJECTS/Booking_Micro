import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, errorCodes, isAppError } from '@universal-booking/core';
import { isExclusionViolation, isUniqueViolation } from '@universal-booking/database';
import { meta } from './envelope';

function pgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof ZodError) {
    return new AppError(
      'VALIDATION_FAILED',
      'The request is invalid.',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (isExclusionViolation(err)) return new AppError('BOOKING_UNAVAILABLE', 'The selected resource was just booked by someone else.');
  if (isUniqueViolation(err)) return new AppError('CONFLICT', 'A record with the same unique value already exists.');
  const code = pgCode(err);
  if (code === '23503') return new AppError('VALIDATION_FAILED', 'A referenced record does not exist.');
  if (code === '23514') return new AppError('VALIDATION_FAILED', 'A value is outside the allowed range.');
  if (code === '22P02') return new AppError('BAD_REQUEST', 'A value has an invalid format.');
  if (code === '42501') return new AppError('FORBIDDEN', 'Access denied.');
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') return new AppError('BAD_REQUEST', 'The request body is not valid JSON.');
  if (type === 'entity.too.large') return new AppError('BAD_REQUEST', 'The request body is too large.', undefined, 413);
  return new AppError('INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  const status = appError.status ?? errorCodes[appError.code];
  if (status >= 500) req.log?.error({ err }, 'request failed');
  else req.log?.debug({ code: appError.code }, appError.message);
  if (res.headersSent) return;
  res.status(status).json({
    success: false,
    error: { code: appError.code, message: appError.message, details: appError.details?.length ? appError.details : undefined },
    meta: meta(res),
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` }, meta: meta(res) });
};
