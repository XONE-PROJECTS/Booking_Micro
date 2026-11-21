export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { requestId?: string; timestamp?: string };
}

export interface BookingClientOptions {
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  tenantId?: string;
}

export class BookingClient {
  constructor(private readonly opts: BookingClientOptions) {}

  private headers(extra: HeadersInit = {}): HeadersInit {
    const h: Record<string, string> = { 'content-type': 'application/json', ...(extra as Record<string, string>) };
    if (this.opts.apiKey) h['x-api-key'] = this.opts.apiKey;
    if (this.opts.accessToken) h.authorization = `Bearer ${this.opts.accessToken}`;
    if (this.opts.tenantId) h['x-tenant-id'] = this.opts.tenantId;
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, { headers: this.headers() });
    const body = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok || !body.success) throw new Error(typeof body === 'object' && 'error' in body ? JSON.stringify(body) : res.statusText);
    return body.data;
  }

  async post<T>(path: string, payload: unknown, idempotencyKey?: string): Promise<T> {
    const headers = this.headers(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {});
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok || !body.success) throw new Error(typeof body === 'object' && 'error' in body ? JSON.stringify(body) : res.statusText);
    return body.data;
  }

  publicCatalog(businessSlug: string) {
    return {
      listServices: (page = 1) => this.get<unknown>(`/public/${businessSlug}/services?page=${page}`),
      getService: (slug: string) => this.get<unknown>(`/public/${businessSlug}/services/${slug}`),
      quote: (payload: unknown) => this.post<unknown>(`/public/${businessSlug}/pricing/quote`, payload),
      searchAvailability: (payload: unknown) => this.post<unknown>(`/public/${businessSlug}/availability/search`, payload),
      createBooking: (payload: unknown, idempotencyKey: string) => this.post<unknown>(`/public/${businessSlug}/bookings`, payload, idempotencyKey),
    };
  }
}