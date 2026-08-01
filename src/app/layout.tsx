import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { FollowModal } from '@/components/FollowModal';
import { Analytics } from '@/components/Analytics';
import { SiteJsonLd } from '@/components/JsonLd';
import { SITE_URL, X_HANDLE, X_URL } from '@/lib/site/nav';
import './globals.css';

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
  robots: {
    index: true,
    follow: true,
    // Let Google show full-length snippets, large image previews and any video.
    // The defaults are conservative and truncate the answer text we most want quoted.
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large', 'max-video-preview': -1 },
  },
  /**
   * Deliberately NO `alternates` here at all.
   *
   * Two separate traps. A `canonical` set at this level would merge into every page and
   * declare each one a duplicate of whatever path it named — the fastest way to de-index
   * a site. And a page-level `alternates` REPLACES the parent's rather than merging into
   * it, so the feed link declared here vanished from every page that set its own
   * canonical, which is all of them. The feed link is a plain <link> in the layout body
   * below, where nothing can override it.
   */
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
        {/* React hoists these into <head>. Declared here rather than through
            `metadata.alternates` because a page-level `alternates` replaces the
            layout's wholesale, and every page sets its own canonical. */}
        <link rel="alternate" type="application/rss+xml" title="Artificial Turf War — Findings" href={`${SITE_URL}/feed.xml`} />
        <link rel="alternate" type="text/plain" title="llms.txt" href={`${SITE_URL}/llms.txt`} />
        <SiteNav />
        {children}
        <Footer />
        <FollowModal />
        <Analytics />
        <SiteJsonLd />
      </body>
    </html>
  );
}
