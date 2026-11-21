import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6767/api/v1';

async function embedFrameAncestors(slug: string): Promise<string> {
  try {
    const res = await fetch(`${API}/public/${encodeURIComponent(slug)}`, { next: { revalidate: 300 } });
    if (!res.ok) return "'self' https: http://localhost:*";
    const json = (await res.json()) as { success: boolean; data?: { branding?: { embedAllowedOrigins?: string[] } } };
    const origins = json.data?.branding?.embedAllowedOrigins?.filter(Boolean) ?? [];
    if (!origins.length) return "'self' https: http://localhost:*";
    return `'self' ${origins.join(' ')}`;
  } catch {
    return "'self' https: http://localhost:*";
  }
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host')?.split(':')[0];
  if (req.nextUrl.pathname.startsWith('/embed/')) {
    const slug = req.nextUrl.pathname.split('/')[2];
    const res = NextResponse.next();
    if (slug) res.headers.set('Content-Security-Policy', `frame-ancestors ${await embedFrameAncestors(slug)}`);
    return res;
  }
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    if (req.nextUrl.pathname.startsWith('/b/')) {
      const slug = req.nextUrl.pathname.replace(/^\/b\//, '').split('/')[0];
      return NextResponse.redirect(new URL(`/${slug}${req.nextUrl.search}`, req.url));
    }
    return NextResponse.next();
  }
  try {
    const res = await fetch(`${API}/public/resolve?domain=${encodeURIComponent(host)}`, { next: { revalidate: 300 } });
    if (res.ok) {
      const json = (await res.json()) as { success: boolean; data?: { slug: string } };
      if (json.success && json.data?.slug) {
        const url = req.nextUrl.clone();
        url.pathname = `/${json.data.slug}${url.pathname === '/' ? '' : url.pathname}`;
        return NextResponse.rewrite(url);
      }
    }
  } catch {
    // fall through
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };