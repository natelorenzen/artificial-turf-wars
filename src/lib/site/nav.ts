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
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.artificialturfwar.com'
).replace(/\/$/, '');

/**
 * Absolute URL for a path. Search engines and answer engines both need absolute URLs
 * in canonical tags, feeds and structured data — a relative one is either ignored or
 * resolved against whatever host the crawler happened to reach, which on this site
 * means the apex that 308s to www.
 */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

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
  /** Rendered dimmer. The archive, not the live season. */
  quiet?: boolean;
}

/*
 * Two groups, split by TIME rather than by topic: what the league is doing now, and the
 * record of how it got here.
 *
 * It used to be three groups and thirteen links, all at one weight, in one sticky bar —
 * so "Weekend", which is this week's article, sat at the same size and colour as "Terms".
 * A reader arriving mid-season had no way to tell which four of the thirteen were the
 * live league. FAQ, Methodology and Terms have moved to the footer, where reference
 * material belongs and where two of the three already were.
 *
 * The rehearsal stays IN THE BAR and stays labelled. Dimming it is fine; hiding it is
 * not, because a visitor who mistakes the 2025 dry run for the live result is the single
 * worst misreading this site can produce, and a hover menu is how that happens.
 */
export const NAV: NavGroup[] = [
  {
    id: 'season',
    items: [
      { href: '/', label: 'Standings', note: 'The live league table' },
      { href: '/results', label: 'Results', note: 'Every scored week, score by score' },
      { href: '/weekend', label: 'Weekend', note: 'How to survive this weekend, every Thursday' },
      { href: '/teams', label: 'Teams', note: 'All eight models and every decision they make' },
      { href: '/ratings', label: 'Skill board', note: 'Who manages best once the luck is out' },
      { href: '/findings', label: 'Findings', note: 'What we learn, published either way' },
    ],
  },
  {
    id: 'record',
    quiet: true,
    items: [
      { href: '/draft', label: 'Draft board', note: 'All 120 picks, every reason as the model gave it' },
      { href: '/preseason', label: 'Pre-season', note: 'Briefing, comprehension gate, auction' },
      {
        href: '/backtest',
        label: 'Rehearsal',
        tag: '2025',
        note: 'The dry run, its five bugs, and its own draft board',
      },
    ],
  },
];

/** Reference material. Footer only — it is not part of following the season. */
export const FOOTER_NAV: NavItem[] = [
  { href: '/faq', label: 'FAQ' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/terms', label: 'Terms' },
];

/** Paths that describe the rehearsal rather than the live season. */
export function isRehearsalPath(pathname: string): boolean {
  return pathname.startsWith('/backtest');
}

export const X_HANDLE = 'playATW';
export const X_URL = `https://x.com/${X_HANDLE}`;
