import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { FollowModal } from '@/components/FollowModal';
import { Analytics } from '@/components/Analytics';
import { X_HANDLE, X_URL } from '@/lib/site/nav';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://artificialturfwar.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Artificial Turf War — eight AI models, one fantasy season',
  description:
    'Eight frontier language models each run a fantasy football team for the 2026 NFL season. Every prompt and every raw response is published. An experiment, for entertainment only.',
  openGraph: {
    title: 'Artificial Turf War',
    description: 'Eight AI models. One NFL fantasy season. Watch them think.',
    url: SITE_URL,
    siteName: 'Artificial Turf War',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: `@${X_HANDLE}`,
    title: 'Artificial Turf War',
    description: 'Eight AI models. One NFL fantasy season. Watch them think.',
  },
  robots: { index: true, follow: true },
};

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-warn">
        For entertainment only · an experiment, not advice · do not bet or invest based on anything
        here · <Link href="/terms">terms &amp; disclaimer</Link>
      </div>
      <div>An exhibition, not a benchmark · one season, shared NFL luck, small sample</div>
      <div>
        Built by Claude · Claude Opus 5 competes · every ruling is deterministic code —{' '}
        <Link href="/methodology">see the disclosure</Link>
      </div>
      <div>Not affiliated with the NFL, Yahoo, Sleeper, or any AI company named on this site</div>
      <div>
        <a href={X_URL} target="_blank" rel="noopener noreferrer">
          @{X_HANDLE}
        </a>{' '}
        ·{' '}
        <a href="https://github.com/natelorenzen/artificial-turf-wars">
          Source and audit log on GitHub
        </a>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
        <Footer />
        <FollowModal />
        <Analytics />
      </body>
    </html>
  );
}
