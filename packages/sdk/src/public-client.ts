import { BookingClient, type BookingClientOptions } from './client';

/** Browser-safe client — no API secrets. */
export class BookingPublicClient extends BookingClient {
  constructor(
    baseUrl: string,
    private readonly slug: string,
  ) {
    super({ baseUrl });
  }

  catalog = () => this.publicCatalog(this.slug);
}