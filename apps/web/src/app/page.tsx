import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell home-landing">
      <h1>Universal Booking</h1>
      <p>
        One Next.js front door for staff administration, branded customer portals, and iframe-ready embed widgets. Business logic and tenancy live in{' '}
        <code>apps/api</code>.
      </p>
      <nav aria-label="Quick links">
        <Link href="/admin">Administrator</Link>
        <Link href="/demo-cafe">Sample portal</Link>
        <Link href="/embed/demo-cafe">Embed widget</Link>
      </nav>
      <div className="card home-cards">
        <article>
          <h2>Portal</h2>
          <p>Guests browse services, get live quotes, pay, and manage bookings under <code>/[businessSlug]</code>.</p>
        </article>
        <article>
          <h2>Admin</h2>
          <p>Staff manage catalog, pricing, availability, reservations, and integrations under <code>/admin</code>.</p>
        </article>
        <article>
          <h2>Embed</h2>
          <p>Drop the booking flow into your site via <code>/embed/[businessSlug]</code> with a slim chrome meant for iframes.</p>
        </article>
      </div>
    </main>
  );
}