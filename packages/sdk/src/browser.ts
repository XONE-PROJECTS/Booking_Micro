export interface WidgetOptions {
  businessSlug: string;
  apiUrl: string;
  container: HTMLElement;
  serviceSlug?: string;
}

/** Minimal embed helper: loads the Next.js embed route in an iframe. */
export function mountBookingWidget(opts: WidgetOptions) {
  const iframe = document.createElement('iframe');
  const webBase = opts.apiUrl.replace(/\/api\/v1\/?$/, '');
  iframe.src = `${webBase}/embed/${encodeURIComponent(opts.businessSlug)}${opts.serviceSlug ? `?service=${encodeURIComponent(opts.serviceSlug)}` : ''}`;
  iframe.title = 'Book now';
  iframe.style.cssText = 'width:100%;min-height:640px;border:0;border-radius:12px';
  opts.container.replaceChildren(iframe);
  return {
    destroy: () => iframe.remove(),
    on(event: string, fn: (data: unknown) => void) {
      const listener = (e: MessageEvent) => {
        if (e.data?.type === `universal-booking:${event}`) fn(e.data.payload);
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}