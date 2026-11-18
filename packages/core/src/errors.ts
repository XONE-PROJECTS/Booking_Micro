export const errorCodes = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BOOKING_UNAVAILABLE: 409,
  CAPACITY_EXCEEDED: 409,
  HOLD_EXPIRED: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  POLICY_VIOLATION: 422,
  CONFIGURATION_INVALID: 422,
  PAYMENT_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  PAYMENT_VERIFICATION_FAILED: 400,
  RATE_LIMITED: 429,
  TENANT_SUSPENDED: 403,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof errorCodes;

export interface ErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetail[] = [],
    status?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? errorCodes[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const errors = {
  badRequest: (message: string, details?: ErrorDetail[]) => new AppError('BAD_REQUEST', message, details),
  validation: (message: string, details?: ErrorDetail[]) => new AppError('VALIDATION_FAILED', message, details),
  unauthenticated: (message = 'Authentication is required.') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action.') => new AppError('FORBIDDEN', message),
  notFound: (entity: string) => new AppError('NOT_FOUND', `${entity} was not found.`),
  conflict: (message: string, details?: ErrorDetail[]) => new AppError('CONFLICT', message, details),
  unavailable: (message = 'The selected resource is no longer available.', details?: ErrorDetail[]) =>
    new AppError('BOOKING_UNAVAILABLE', message, details),
  capacity: (message = 'Not enough capacity remains for this request.', details?: ErrorDetail[]) =>
    new AppError('CAPACITY_EXCEEDED', message, details),
  invalidTransition: (from: string, action: string) =>
    new AppError('INVALID_TRANSITION', `Action "${action}" is not allowed from status "${from}".`),
  policy: (message: string, details?: ErrorDetail[]) => new AppError('POLICY_VIOLATION', message, details),
  configuration: (message: string, details?: ErrorDetail[]) => new AppError('CONFIGURATION_INVALID', message, details),
};
