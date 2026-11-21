import type { Metadata } from 'next';
import { Newsreader, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const serif = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Universal Booking',
  description: 'Admin, customer portal, and embeddable booking widgets.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
