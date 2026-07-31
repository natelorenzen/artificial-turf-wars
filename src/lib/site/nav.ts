/**
 * Site structure.
 *
 * The organizing problem: this site holds two seasons that look alike and mean very
 * different things. 2026 is the real league, unfolding week by week. 2025 is a
 * rehearsal against a season whose results were already known — useful, published in
 * full, and *not* a competition anyone won.
 *
 * A flat menu invites the worst possible misreading: a visitor sees a standings table
 * with Claude Opus 5 on top and takes it for the live result. So the nav is grouped,
 * the rehearsal is labelled as such in every group it appears in, and every rehearsal
 * page carries a banner saying so.
 */

/**
 * The canonical origin, with no trailing slash.
 *
 * One definition because three things have to agree or search engines see the site as
 * two sites: `metadataBase` in the root layout, the `<loc>` in sitemap.xml, and the
 * `Sitemap:` line in robots.txt. A preview deployment overrides it via
 * NEXT_PUBLIC_SITE_URL so preview builds never advertise themselves as production.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://artificialturfwar.com').replace(
  /\/$/,
  '',
);

export interface NavItem {
  href: string;
  label: string;
  /**
   * A season marker rendered as part of the link itself.
   *
   * This used to be a heading stacked above each group. That doubled the height of the
   * sticky bar, and — worse — it was a promise the layout could break: the moment the
   * bar wrapped, or the mobile breakpoint hid the heading, "Results" and "Draft board"
   * were bare labels with nothing saying which season they belonged to. Attached to the
   * link, the marker cannot be separated from the thing it qualifies.
   */
  tag?: string;
  /** Shown in the grouped mobile menu, not in the top bar. */
  note?: string;
}

export interface NavGroup {
  id: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: 'season',
    items: [
      { href: '/', label: 'Standings', note: 'The live league, week by week' },
      { href: '/preseason', label: 'Pre-season', note: 'Briefing, comprehension gate, auction' },
      { href: '/teams', label: 'Teams', note: 'All eight models and every decision they make' },
    ],
  },
  {
    id: 'rehearsal',
    items: [
      {
        href: '/backtest',
        label: 'Rehearsal',
        tag: '2025',
        note: 'What the backtest found, including five bugs',
      },
      {
        href: '/backtest/draft',
        label: 'Draft board',
        tag: '2025',
        note: 'All 120 picks with reasoning',
      },
    ],
  },
  {
    id: 'about',
    items: [
      { href: '/findings', label: 'Findings', note: 'What we learn, published either way' },
      { href: '/methodology', label: 'Methodology', note: 'How it works and what it cannot show' },
      { href: '/terms', label: 'Terms', note: 'Entertainment only — not advice of any kind' },
    ],
  },
];

/** Paths that describe the rehearsal rather than the live season. */
export function isRehearsalPath(pathname: string): boolean {
  return pathname.startsWith('/backtest');
}

export const X_HANDLE = 'playATW';
export const X_URL = `https://x.com/${X_HANDLE}`;
