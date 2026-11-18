export * from './common';
export * from './events';
export * from './inputs';
export * from './responses';
export * from './openapi';

import type { z } from 'zod';
import type * as I from './inputs';
import type * as R from './responses';

export type CreateBookingInput = z.input<typeof I.createBookingInput>;
export type AvailabilitySearchInput = z.input<typeof I.availabilitySearchInput>;
export type QuoteInput = z.input<typeof I.quoteInput>;
export type BookingView = z.infer<typeof R.bookingView>;
export type AvailabilityResult = z.infer<typeof R.availabilityResult>;
export type SlotView = z.infer<typeof R.slot>;
export type CalendarDayView = z.infer<typeof R.calendarDay>;
export type ServiceView = z.infer<typeof R.serviceView>;
export type PricingResultView = z.infer<typeof R.pricingResult>;
export type AuthSession = z.infer<typeof R.authSession>;
