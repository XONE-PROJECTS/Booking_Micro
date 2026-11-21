import { BookingClient, type BookingClientOptions } from './client';

/** Server-side client — may use API keys; never ship secrets to the browser. */
export class BookingServerClient extends BookingClient {
  constructor(opts: BookingClientOptions & { apiKey: string }) {
    super(opts);
  }

  listBookings(query = '') {
    return this.get<unknown>(`/bookings${query ? `?${query}` : ''}`);
  }

  recordPayment(bookingId: string, body: unknown) {
    return this.post<unknown>(`/bookings/${bookingId}/payments/record`, body);
  }
}