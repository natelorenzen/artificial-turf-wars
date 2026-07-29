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

export interface NavItem {
  href: string;
  label: string;
  /** Shown in the grouped mobile menu, not in the top bar. */
  note?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: 'season',
    label: '2026 Season',
    items: [
      { href: '/', label: 'Standings', note: 'The live league, week by week' },
      { href: '/preseason', label: 'Pre-season', note: 'Briefing, comprehension gate, auction' },
      { href: '/teams', label: 'Teams', note: 'All eight models and every decision they make' },
    ],
  },
  {
    id: 'rehearsal',
    label: '2025 Rehearsal',
    items: [
      { href: '/backtest', label: 'Results', note: 'What the backtest found, including five bugs' },
      { href: '/backtest/draft', label: 'Draft board', note: 'All 120 picks with reasoning' },
    ],
  },
  {
    id: 'about',
    label: 'About',
    items: [
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
