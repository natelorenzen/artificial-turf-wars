import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COHORT } from '@/lib/config/league';
import { buildRulesCheck } from '@/lib/preseason/rules-check';
import type { CurrentWeekView, SeasonSnapshot } from '@/lib/site/results';
import {
  assembleFacts,
  formatPriceRange,
  gateFromChecks,
  gateScore,
  priceRange,
  seasonStatus,
  type PublicFacts,
} from '@/lib/site/public-facts';

/**
 * The homepage, /faq and /llms.txt must never disagree about season status, the current
 * week, the price range, the rules-gate score or the cohort.
 *
 * They did, on 11 Oct 2026: week 5 was being played, the homepage said so and said
 * 19/19, and the other two said the season had not started, 17 out of 17, and $0.32.
 * Each was hand-typed. This file renders all three from one set of facts and checks
 * every one of those facts appears, identically, in each.
 */

// ---------------------------------------------------------------------------
// A mid-season fixture, wired into every loader the three surfaces call
// ---------------------------------------------------------------------------

const current: CurrentWeekView = {
  week: 5,
  firstKickoff: '2026-10-09T00:15:00Z',
  kickedOff: true,
  lineupsSet: 8,
  carriedForward: 0,
  fixtures: [],
  guide: null,
  scored: false,
  live: null,
};

const snapshot: SeasonSnapshot = {
  season: 2026,
  throughWeek: 4,
  rankingBasis: 'h2h' as SeasonSnapshot['rankingBasis'],
  playoffSpots: 4,
  champion: null,
  table: COHORT.map((m, i) => ({
    model: m.displayName,
    modelKey: m.key,
    record: i === 0 ? '3-1' : '2-2',
    allPlay: '14-14',
    pointsFor: 400 - i,
    rank: i + 1,
    coRanked: false,
  })),
};

const FACTS: PublicFacts = assembleFacts({
  season: 2026,
  dbAvailable: true,
  current,
  snapshot,
  gate: { passed: 8, of: 8, score: 19, maxScore: 19, firstAttempt: true, source: 'database' },
});

vi.mock('@/lib/site/results', async (orig) => ({
  ...(await orig<typeof import('@/lib/site/results')>()),
  loadCurrentWeek: async () => current,
  loadSeasonSnapshot: async () => snapshot,
}));

vi.mock('@/lib/site/public-facts', async (orig) => ({
  ...(await orig<typeof import('@/lib/site/public-facts')>()),
  loadPublicFacts: async () => FACTS,
}));

async function renderSurfaces(): Promise<Record<'home' | 'faq' | 'llms', string>> {
  const [{ default: Home }, { default: Faq }, { GET }] = await Promise.all([
    import('@/app/page'),
    import('@/app/faq/page'),
    import('@/app/llms.txt/route'),
  ]);
  // HTML entities and tags out, whitespace collapsed: compare what a reader sees.
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
  return {
    home: text(renderToStaticMarkup(await Home())),
    faq: text(renderToStaticMarkup(await Faq())),
    llms: (await (await GET()).text()).replace(/\s+/g, ' '),
  };
}

describe('homepage, /faq and /llms.txt agree', () => {
  it('on season status, current week, price range, gate score and cohort', async () => {
    const surfaces = await renderSurfaces();
    const facts = [
      ['status', FACTS.status.sentence],
      ['current week', `week ${FACTS.status.currentWeek} of 14`],
      ['price range', formatPriceRange(FACTS.prices)],
      ['gate score', gateScore(FACTS.gate)],
      ...FACTS.cohort.map((m) => ['cohort', m.displayName] as const),
    ] as const;

    const missing: string[] = [];
    for (const [surface, body] of Object.entries(surfaces)) {
      for (const [label, value] of facts) {
        if (!body.includes(value)) missing.push(`${surface} lacks ${label}: "${value}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('none of them states a status the facts contradict', async () => {
    const surfaces = await renderSurfaces();
    for (const [surface, body] of Object.entries(surfaces)) {
      expect(body, surface).not.toMatch(/has not (started|kicked off)|NOT started/);
    }
  });
});

// ---------------------------------------------------------------------------
// Stale literals, anywhere a reader or a crawler can see them
// ---------------------------------------------------------------------------

const PUBLIC_DIRS = [join(process.cwd(), 'src', 'app'), join(process.cwd(), 'src', 'components')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'api' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

/** Comments out, so a file may explain the history of a bug without re-committing it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('public pages carry no hand-typed copy of a generated fact', () => {
  const files = PUBLIC_DIRS.flatMap(sourceFiles).map((f) => ({
    file: f.replace(process.cwd() + '/', ''),
    src: stripComments(readFileSync(f, 'utf8')),
  }));

  it.each([
    ['a gate score', /\b\d{1,2}\s*(\/|out of)\s*\d{1,2}\b[^\n]{0,80}(comprehension|rules)|(comprehension|rules)[^\n]{0,80}\b\d{1,2}\s*(\/|out of)\s*\d{1,2}\b/i],
    ['a price floor or ceiling', /\$\d+\.\d\d\s*(to|–|-)\s*\$\d+\.\d\d/],
    ['a season-status claim', /season has not (started|kicked off)|has NOT started|hasn.t started/i],
  ])('no page types %s', (_label, pattern) => {
    const offenders = files.filter(({ src }) => pattern.test(src)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The facts themselves
// ---------------------------------------------------------------------------

describe('price range', () => {
  it('is the cohort’s cheapest and dearest input price', () => {
    const range = priceRange();
    expect(range.min).toBe(Math.min(...COHORT.map((m) => m.priceIn)));
    expect(range.max).toBe(Math.max(...COHORT.map((m) => m.priceIn)));
    expect(formatPriceRange(range)).toBe('$0.58 to $5.00 per million input tokens');
    expect(range.floorModel).toBe('DeepSeek V4 Pro 0813');
  });
});

describe('rules gate', () => {
  it('summarises each team’s final attempt', () => {
    const gate = gateFromChecks([
      { score: 19, maxScore: 19, attempts: 1, passed: true },
      { score: 18, maxScore: 19, attempts: 2, passed: true },
    ])!;
    expect(gate).toMatchObject({ passed: 2, of: 2, score: 18, maxScore: 19, firstAttempt: false });
  });

  it('falls back to the question count the code actually asks', () => {
    expect(buildRulesCheck().length).toBe(19);
  });
});

describe('season status', () => {
  const base = { season: 2026, dbAvailable: true, snapshot: { throughWeek: null, champion: null, table: [] } };

  it('never says "not started" without a database to ask', () => {
    const s = seasonStatus({ ...base, dbAvailable: false, current: null });
    expect(s.phase).toBe('unknown');
    expect(s.sentence).not.toMatch(/not kicked off/);
  });

  it('is under way from the first locked lineup, before anything is scored', () => {
    const s = seasonStatus({ ...base, current: { week: 1, scored: false, kickedOff: false } });
    expect(s.phase).toBe('regular-season');
    expect(s.sentence).toBe('The 2026 season is under way: week 1 of 14 has its lineups locked. No week has been scored yet.');
  });

  it('names the playoffs and the champion', () => {
    expect(seasonStatus({ ...base, current: { week: 15, scored: false, kickedOff: true } }).phase).toBe('playoffs');
    const done = seasonStatus({
      ...base,
      snapshot: { throughWeek: 14, champion: 'Kimi K3', table: [] },
      current: { week: 16, scored: true, kickedOff: true },
    });
    expect(done.sentence).toBe('The 2026 season is complete. Kimi K3 won the title.');
  });
});
