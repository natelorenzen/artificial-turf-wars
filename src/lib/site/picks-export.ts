/**
 * Every model's NFL predictions as read-only JSON, for agents.
 *
 *   /data/picks/index.json    — weeks available, the season board, links
 *   /data/picks/latest.json   — the newest week with stored picks
 *   /data/picks/N.json        — one week: every game, every model's pick, probability,
 *                               stated reason and bet, the consensus and the market line
 *
 * One fetch should be enough for an agent to learn what all eight models predicted and
 * how they have done, without scraping /picks. It is the same data, through the same
 * loaders (`loadPicksWeek`, `loadPicksBoard`), so the export cannot disagree with the
 * page. Picks are published once they lock, before kickoff, exactly as /picks shows them.
 *
 * What it is not: advice. The bankroll is play money and the site names no book
 * (`disclaimer`, on every response). The probabilities are each model's own assertion;
 * we add no forecast of our own (hard rule 10).
 */

import { COHORT } from '@/lib/config/league';
import { absoluteUrl } from '@/lib/site/nav';
import { SEASON } from '@/lib/site/results';
import { loadPicksBoard, loadPicksWeek, pickWeeks, type PicksWeek } from '@/lib/site/picks';
import type { PickTally } from '@/lib/picks/grade';

export const PICKS_EXPORT_SCHEMA = 'artificialturfwar.picks.v1';

export const PICKS_DISCLAIMER =
  'Predictions made by AI models in an exhibition, for entertainment only. Play money; no sportsbook is named or endorsed. Not betting or financial advice.';

const round = (n: number | null, dp = 4) => (n === null ? null : Math.round(n * 10 ** dp) / 10 ** dp);

function tallyView(t: PickTally) {
  return {
    won: t.won,
    lost: t.lost,
    push: t.push,
    pending: t.pending,
    accuracy: round(t.accuracy),
    brier: round(t.brier),
    meanConfidence: round(t.meanConfidence),
  };
}

/** Pure: one stored week in export shape. Exported for the test. */
export function shapePicksWeek(pw: PicksWeek, season: number) {
  const byGame = new Map(pw.outcomes.map((o) => [o.gameKey, o]));
  const consensusOf = new Map(pw.consensus.map((c) => [c.gameKey, c]));
  const gameKeys = [...new Set(pw.sets.flatMap((s) => [...s.picks.keys()]))].sort();

  const games = gameKeys.map((gameKey) => {
    const [away, home] = gameKey.split('@');
    const outcome = byGame.get(gameKey);
    const line = pw.lines.get(gameKey) ?? null;
    const market = pw.market.get(gameKey);
    const consensus = consensusOf.get(gameKey);
    const picks = pw.sets
      .flatMap((s) => {
        const p = s.picks.get(gameKey);
        return p
          ? [
              {
                model: s.model,
                modelKey: s.modelKey,
                pick: p.pick,
                winProb: p.winProb,
                reason: p.reason,
                bet: p.bet ? { team: p.bet.team, stake: p.bet.stake, americanOdds: p.bet.price, result: p.bet.result, pnl: p.bet.pnl } : null,
                result: p.result,
              },
            ]
          : [];
      })
      .sort((a, b) => a.model.localeCompare(b.model));
    return {
      gameKey,
      away,
      home,
      result: outcome
        ? { awayScore: outcome.awayScore, homeScore: outcome.homeScore, winner: outcome.winner }
        : { awayScore: null, homeScore: null, winner: null },
      market: line
        ? {
            americanOdds: line,
            fairProb: market ? { away: round(market.get(away) ?? null), home: round(market.get(home) ?? null) } : null,
          }
        : null,
      consensus: consensus ? { pick: consensus.pick, winProb: round(consensus.winProb), result: consensus.result } : null,
      split: Object.fromEntries(
        [away, home].map((team) => [team, picks.filter((p) => p.pick === team).length]),
      ) as Record<string, number>,
      picks,
    };
  });

  return {
    schema: PICKS_EXPORT_SCHEMA,
    season,
    week: pw.week,
    page: absoluteUrl(`/picks/${pw.week}`),
    resultKey: {
      pending: 'game not yet scored',
      won: 'picked team won',
      lost: 'picked team lost',
      push: 'tie',
    },
    notes: [
      'winProb is the model’s own stated probability that its picked team wins (0.5–1).',
      'market.fairProb is the consensus moneyline with the bookmaker margin removed; every model saw the same line.',
      'Scores are recomputed from defensive points allowed at read time, final over provisional, so a stat correction can regrade a pick.',
      'Every model saw one byte-identical prompt per week (contextHashes); the full prompt and raw responses are on the page.',
    ],
    contextHashes: pw.contextHashes,
    models: pw.sets
      .slice()
      .sort((a, b) => a.model.localeCompare(b.model))
      .map((s) => ({
        model: s.model,
        modelKey: s.modelKey,
        headline: s.headline,
        valid: s.valid,
        lockedAt: s.lockedAt,
        bankrollAvailable: s.bankrollAvailable,
        week: tallyView(s.tally),
        bets: { staked: s.weekBets.staked, atRisk: s.weekBets.atRisk, pnl: round(s.weekBets.balance, 2) },
      })),
    baselines: {
      consensus: tallyView(pw.consensusTally),
      homeTeam: tallyView(pw.homeTally),
      marketFavourite: pw.marketTally ? tallyView(pw.marketTally) : null,
    },
    againstTheGrain: pw.dissents.map((d) => ({
      model: d.model,
      modelKey: d.modelKey,
      gameKey: d.pick.gameKey,
      pick: d.pick.pick,
      winProb: d.pick.winProb,
      marketProb: round(d.marketProb),
      claimedEdge: round(d.claimedEdge),
      panel: `${d.of - d.agree} against ${d.agree}`,
      result: d.pick.result,
    })),
    games,
    disclaimer: PICKS_DISCLAIMER,
  };
}

export async function loadPicksExport(week: number, season = SEASON) {
  const pw = await loadPicksWeek(week, season);
  return pw ? shapePicksWeek(pw, season) : null;
}

export async function latestPicksWeek(season = SEASON): Promise<number | null> {
  return (await pickWeeks(season))[0] ?? null;
}

export async function loadPicksIndex(season = SEASON) {
  const board = await loadPicksBoard(season);
  const weeks = board?.weeks ?? [];
  return {
    schema: PICKS_EXPORT_SCHEMA,
    season,
    page: absoluteUrl('/picks'),
    latest: weeks[0] ? absoluteUrl(`/data/picks/${weeks[0]}.json`) : null,
    weeks: weeks.map((w) => ({ week: w, url: absoluteUrl(`/data/picks/${w}.json`) })),
    cohort: COHORT.map((m) => ({ key: m.key, model: m.displayName, lab: m.lab })),
    season_board: board
      ? {
          rankedBy: 'Brier score (lower is better), then accuracy',
          models: board.rows.map((r) => ({
            model: r.model,
            modelKey: r.modelKey,
            weeks: r.weeks,
            ...tallyView(r.tally),
            bankroll: { balance: r.bankroll.balance, atRisk: r.bankroll.atRisk, staked: r.bankroll.staked },
          })),
          baselines: {
            consensus: tallyView(board.consensus),
            homeTeam: tallyView(board.home),
            marketFavourite: board.market ? tallyView(board.market) : null,
          },
        }
      : null,
    disclaimer: PICKS_DISCLAIMER,
  };
}
