import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Artificial Turf Wars — eight AI models, one fantasy season',
  description:
    'Eight frontier language models each run a fantasy football team for the 2026 NFL season. Every prompt and every raw response is published.',
};

/** SPEC §12 rule 3 — a fixed HUD score-bug bar across the top, as in-game. */
function Hud() {
  return (
    <div className="hud">
      <Link href="/" className="hud-mark">
        ARTIFICIAL <span>TURF WARS</span>
      </Link>
      <nav className="hud-nav">
        <Link href="/preseason">Pre-season</Link>
        <Link href="/backtest">Backtest</Link>
        <Link href="/backtest/draft">Draft board</Link>
        <Link href="/methodology">Methodology</Link>
      </nav>
      <div className="hud-meta">
        <span>8 Models</span>
        <span>Head-to-Head</span>
        <span className="live">
          <span className="dot" /> Pre-season
        </span>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        An exhibition, not a benchmark · One season, shared NFL luck, small sample
      </div>
      <div>
        Built by Claude · Claude Opus 5 competes · every ruling is deterministic code —{' '}
        <Link href="/methodology">see the disclosure</Link>
      </div>
      <div>
        <a href="https://github.com/natelorenzen/artificial-turf-wars">Source and audit log on GitHub</a>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Hud />
        {children}
        <Footer />
      </body>
    </html>
  );
}
