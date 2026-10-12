/**
 * One league week as read-only JSON, served at /data/week/N.json.
 *
 * robots.txt keeps crawlers off /api/ (those are cron routes), so until this existed
 * the only machine-readable way into a week was scraping HTML. This is the same data
 * the pages render, through the same loaders — `loadMatchup`, `loadSeasonSnapshot`,
 * `loadWaiverRun` — so the export cannot disagree with `/results/N`.
 *
 * Every score carries the status it was read at. `live` is unofficial and moves;
 * `provisional` is Tuesday's; `final` is Thursday's and never changes (hard rule 7).
 */

import { COHORT, LEAGUE } from '@/lib/config/league';
import { absoluteUrl } from '@/lib/site/nav';
import { SEASON, loadSeasonSnapshot } from '@/lib/site/results';
import { loadFixtureLinks, loadMatchup, type BoxPlayer, type MatchupSide, type MatchupStatus } from '@/lib/site/matchup';
import { loadWaiverRun } from '@/lib/site/waivers';

export const WEEK_EXPORT_SCHEMA = 'artificialturfwar.week.v1';

const decisionUrl = (id: string | null) => (id ? absoluteUrl(`/decisions/${id}`) : null);

function player(p: BoxPlayer | null) {
  if (!p) return null;
  return {
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    nflTeam: p.nflTeam,
    opponent: p.opponent,
    points: p.points,
    projected: p.projected,
  };
}

function side(s: MatchupSide) {
  return {
    model: s.model,
    modelKey: s.modelKey,
    points: s.points,
    projected: s.projected,
    optimal: s.optimal,
    efficiency: s.efficiency,
    autopilotDelta: s.autopilot?.delta ?? null,
    lineup: {
      reasoningUrl: decisionUrl(s.lineup.decisionId),
      headline: s.lineup.headline,
      closestCall: s.lineup.closestCall,
      confidence: s.lineup.confidence,
      /** True when the league's code chose this lineup, not the model. */
      fallback: s.lineup.fallback,
      starters: s.starters.map((slot) => ({ slot: slot.slot, player: player(slot.player) })),
      bench: s.bench.map((b) => player(b)),
    },
  };
}

export async function loadWeekExport(week: number, season = SEASON) {
  const fixtures = await loadFixtureLinks(week, season);
  if (fixtures.length === 0) return null;

  const views = (await Promise.all(fixtures.map((f) => loadMatchup(week, f.slug, season)))).filter(
    (v): v is NonNullable<typeof v> => v !== null,
  );
  if (views.length === 0) return null;

  const statuses = new Set<MatchupStatus>(views.map((v) => v.status));
  const scored = views.every((v) => v.status === 'final' || v.status === 'provisional');

  // The table after this week, once this week has been scored. Playoff weeks write no
  // standings row on purpose, so they carry none.
  const snapshot = scored && week <= LEAGUE.regularSeasonWeeks ? await loadSeasonSnapshot(season, week) : null;
  const standings =
    snapshot && snapshot.throughWeek === week
      ? {
          throughWeek: week,
          status: statuses.has('provisional') ? 'provisional' : 'final',
          basis: 'head-to-head record ranks; points-for breaks ties; all-play is shown and does not rank',
          table: snapshot.table,
        }
      : null;

  const run = await loadWaiverRun(week, season);
  const waivers = run
    ? {
        week,
        joinsForWeek: week + 1,
        url: absoluteUrl(`/waivers/${week}`),
        sealed: run.sealed,
        status: run.sealed ? 'sealed until Wednesday resolution' : 'final',
        summary: run.brief,
        teams: run.teams.map((t) => ({
          model: t.model,
          modelKey: t.modelKey,
          reasoningUrl: decisionUrl(t.decisionId),
          headline: t.headline,
          fallback: t.fallback,
          faabBefore: t.faabBefore,
          faabAfter: t.faabAfter,
          bids: t.bids.map((b) => ({
            add: b.add,
            drop: b.drop,
            bid: b.bid,
            won: b.won,
            losingReason: b.losingReason,
          })),
        })),
      }
    : null;

  return {
    schema: WEEK_EXPORT_SCHEMA,
    season,
    week,
    generatedAt: new Date().toISOString(),
    statusKey: {
      upcoming: 'lineups locked, nothing played; projections only',
      live: 'unofficial, refreshed a few times a game day, nothing is derived from it',
      provisional: "Tuesday's official score; may be corrected on Thursday",
      final: "Thursday's score after stat corrections; never overwritten",
    },
    links: {
      results: absoluteUrl(`/results/${week}`),
      picks: absoluteUrl(`/picks/${week}`),
      weekendGuide: absoluteUrl(`/weekend/${week}`),
      waivers: absoluteUrl(`/waivers/${week}`),
      videoBrief: absoluteUrl(`/data/week/${week}/video.json`),
    },
    cohort: COHORT.map((m) => ({ key: m.key, model: m.displayName, lab: m.lab })),
    matchups: views.map((v) => ({
      slug: v.slug,
      url: absoluteUrl(`/results/${week}/${v.slug}`),
      status: v.status,
      computedAt: v.computedAt,
      home: side(v.home),
      away: side(v.away),
      story: v.story,
    })),
    standings,
    waivers,
    disclaimer: 'An exhibition, not a benchmark. For entertainment only; nothing here is betting advice.',
  };
}
