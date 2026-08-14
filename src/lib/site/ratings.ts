/**
 * The skill board: what a model is worth once the luck is taken out.
 *
 * Head-to-head decides the season, and head-to-head over fourteen weeks is mostly
 * noise — a team can start the right nine players and lose by forty because somebody
 * else's tight end scored three times. So the standings answer "who won" and this
 * answers three questions that survive the variance:
 *
 *   CALIBRATION  Did the model know what it knew? Every lineup carries a stated
 *                probability of beating that week's opponent. Forecasts are scoreable
 *                in a way fantasy points are not.
 *   LINEUP SKILL Points started as a share of the best available from the roster held.
 *                Contains no luck about the opponent at all — only "did you start the
 *                right nine".
 *   ALL-PLAY     Win rate against all seven rivals each week, which removes the
 *                schedule but keeps the players' own variance.
 *
 * Nothing here calls a model, and every figure recomputes from published rows.
 *
 * THE HONESTY CONSTRAINT. `confidence` was an undefined field until 14 August 2026 —
 * it appeared in the output example as 0.5 and nothing said what it meant. Models
 * answered anyway. Those numbers are not answers to "will you win", so they are
 * excluded by prompt version rather than quietly averaged in. Publishing "this model is
 * overconfident" on the strength of a question nobody asked would be the same mistake
 * that produced three false failure reports in rehearsal.
 */

import { LEAGUE, PROMPT_VERSION, RANKING_BASIS } from '@/lib/config/league';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';
import { allPlayWeek } from '@/lib/engine/allplay';
import {
  calibrate,
  describeCalibration,
  type CalibrationReport,
  type Forecast,
} from '@/lib/engine/calibration';
import { loadWeeklyTotals } from '@/lib/scoring/week';
import { LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';
import { optimalLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { decisionScore, type DecisionScore, type WeeklyDelta } from '@/lib/engine/decision-score';
import type { Position } from '@/lib/config/league';
import { SEASON } from './results';

/**
 * Read every row, not the first thousand.
 *
 * PostgREST caps an unbounded select at 1000 rows and reports the truncation in no way
 * at all. A hundred and fifty rostered players across eighteen weeks is 2,700 stat
 * rows, so the cap silently dropped most of the actual scores — which made the baseline
 * lineup score near-zero and every model look like it had added a hundred points a
 * fortnight. Caught by checking one team by hand: its baseline and its real lineup were
 * the same 122.92, a delta of exactly zero.
 *
 * This project has been bitten by this exact class of bug before, on the projections
 * dedupe. Pagination is not an optimisation here; it is the difference between a
 * published rating and a fabricated one.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`ratings: ${(error as { message?: string }).message ?? 'read failed'}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

/**
 * The deterministic manager every model is measured against.
 *
 * Not a hypothetical. It is the same best-projection lineup the cron seeds for all
 * eight teams BEFORE the first model call, reconstructed here from the roster each team
 * actually held that week and then scored with what those players really did. The
 * difference between it and the model's own lineup is the part of the week the model
 * chose — the same roster, the same opponent, the same variance, subtracted away.
 */
async function baselineDeltas(
  seasonId: string,
  season: number,
  teamIds: string[],
  totals: Map<string, Map<number, { total: number }>>,
): Promise<Map<string, WeeklyDelta[]>> {
  const out = new Map<string, WeeklyDelta[]>(teamIds.map((id) => [id, []]));

  const { data: rosterRows } = await supabase
    .from('rosters')
    .select('team_id, player_id, acquired_week, dropped_week, players!inner(position)')
    .in('team_id', teamIds);
  const rosters = (rosterRows ?? []) as unknown as {
    team_id: string;
    player_id: string;
    acquired_week: number | null;
    dropped_week: number | null;
    players: { position: Position };
  }[];
  if (rosters.length === 0) return out;

  // Only rostered players are ever needed, which keeps this to a couple of thousand
  // rows rather than the whole projection board for every week of the season.
  const playerIds = [...new Set(rosters.map((r) => r.player_id))];

  const projRows = await fetchAll<{ player_id: string; week: number; proj_pts: number | null }>(
    (from, to) =>
      supabase
        .from('player_projections')
        .select('player_id, week, proj_pts')
        .eq('season', season)
        .not('week', 'is', null)
        .in('player_id', playerIds)
        .order('id', { ascending: true })
        .range(from, to),
  );

  const actualRows = await fetchAll<{
    player_id: string;
    week: number;
    computed_pts: number | null;
    status: string;
  }>((from, to) =>
    supabase
      .from('player_stats')
      .select('player_id, week, computed_pts, status')
      .eq('season', season)
      .in('player_id', playerIds)
      // Ordered so `final` is seen before `provisional` for the same player-week, and
      // paged on a unique column so rows cannot shuffle between requests.
      .order('status', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );

  const projected = new Map<string, number>();
  for (const row of projRows) {
    projected.set(`${row.player_id}:${row.week}`, Number(row.proj_pts ?? 0));
  }

  // Final beats provisional for the same player-week, exactly as the scoring engine
  // resolves it — a page and a scoreline disagreeing about a player is not allowed.
  const actual = new Map<string, number>();
  const seenFinal = new Set<string>();
  for (const row of actualRows) {
    const key = `${row.player_id}:${row.week}`;
    if (seenFinal.has(key)) continue;
    if (row.status === 'final') seenFinal.add(key);
    actual.set(key, Number(row.computed_pts ?? 0));
  }

  for (const teamId of teamIds) {
    const mine = rosters.filter((r) => r.team_id === teamId);

    for (let week = 1; week <= LAST_LEAGUE_WEEK; week++) {
      const modelPts = totals.get(teamId)?.get(week)?.total;
      // No score means the week was never played or never scored. Not a zero.
      if (modelPts === undefined) continue;

      // The roster as it stood that week: acquired by then, not yet dropped.
      const held = mine.filter(
        (r) =>
          (r.acquired_week ?? 0) <= week &&
          (r.dropped_week === null || r.dropped_week > week),
      );
      if (held.length === 0) continue;

      const byProjection: LineupPlayer[] = held.map((r) => ({
        playerId: r.player_id,
        position: r.players.position,
        points: projected.get(`${r.player_id}:${week}`) ?? 0,
      }));

      // Chosen on PROJECTION — that is the decision the sort would have made — then
      // paid out at ACTUAL points, which is the week that really happened.
      const chosen = optimalLineup(byProjection).lineup;
      const startedIds = [
        chosen.qb,
        ...chosen.rb,
        ...chosen.wr,
        chosen.te,
        chosen.flex,
        chosen.k,
        chosen.def,
      ].filter((id): id is string => Boolean(id));

      const baselinePts = startedIds.reduce(
        (sum, id) => sum + (actual.get(`${id}:${week}`) ?? 0),
        0,
      );

      out.get(teamId)!.push({ week, modelPts, baselinePts: Number(baselinePts.toFixed(2)) });
    }
  }

  return out;
}

/**
 * Points the drafted roster was worth over a league where ALL EIGHT drafted by
 * projection.
 *
 * The obvious counterfactual — "at each of your picks, what if you had taken the best
 * projected player still there?" — is wrong, and wrong in a way that looks fine until
 * you read the output. Applied per team it lets every team's shadow drafter claim the
 * same top players, because only the REAL picks are removed from the board. All eight
 * are then measured against a drafter with first refusal on everything, and all eight
 * come out hundreds of points behind a standard no manager in the league could have
 * met. The first version of this file did exactly that and rated the entire cohort as
 * catastrophic.
 *
 * So the baseline is a whole league: replay the real pick order with every team taking
 * the highest projected player available. That gives each SLOT a fair counterfactual —
 * what the eighth pick would have got if the eighth pick had simply sorted — and the
 * difference is the part the model's judgment is responsible for.
 */
async function draftDeltas(
  seasonId: string,
  season: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const { data: picks } = await supabase
    .from('draft_picks')
    .select('pick_overall, team_id, player_id')
    .eq('season_id', seasonId)
    .order('pick_overall', { ascending: true });
  if (!picks || picks.length === 0) return out;

  const board = await fetchAll<{ player_id: string; proj_pts: number | null }>((from, to) =>
    supabase
      .from('player_projections')
      .select('player_id, proj_pts')
      .eq('season', season)
      .is('week', null)
      .order('proj_pts', { ascending: false })
      .range(from, to),
  );
  if (board.length === 0) return out;

  const pool = board.slice(0, 1000).map((b) => b.player_id);
  const relevant = [...new Set([...pool, ...picks.map((p) => p.player_id as string)])];

  const seasonPts = new Map<string, number>();
  for (let start = 0; start < relevant.length; start += 200) {
    const slice = relevant.slice(start, start + 200);
    const rows = await fetchAll<{ player_id: string; computed_pts: number | null }>((from, to) =>
      supabase
        .from('player_stats')
        .select('player_id, computed_pts, week')
        .eq('season', season)
        .lte('week', LEAGUE.regularSeasonWeeks)
        .in('player_id', slice)
        .order('id', { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      seasonPts.set(row.player_id, (seasonPts.get(row.player_id) ?? 0) + Number(row.computed_pts ?? 0));
    }
  }

  // The shadow league: same order, every team sorting.
  const takenByBaseline = new Set<string>();
  const baselineTotal = new Map<string, number>();
  for (const pick of picks) {
    const teamId = pick.team_id as string;
    const next = pool.find((id) => !takenByBaseline.has(id));
    if (!next) break;
    takenByBaseline.add(next);
    baselineTotal.set(teamId, (baselineTotal.get(teamId) ?? 0) + (seasonPts.get(next) ?? 0));
  }

  const actualTotal = new Map<string, number>();
  for (const pick of picks) {
    const teamId = pick.team_id as string;
    actualTotal.set(
      teamId,
      (actualTotal.get(teamId) ?? 0) + (seasonPts.get(pick.player_id as string) ?? 0),
    );
  }

  for (const [teamId, actualPts] of actualTotal) {
    out.set(teamId, Number((actualPts - (baselineTotal.get(teamId) ?? 0)).toFixed(2)));
  }
  return out;
}

/**
 * Prompt versions under which `confidence` meant "probability I win this week".
 *
 * A list rather than a comparison, because "sys-v4 > sys-v3" is a string comparison
 * waiting to be wrong, and because a future version might change the question again.
 * Adding one here is a deliberate statement that its forecasts are comparable.
 */
export const CALIBRATED_PROMPT_VERSIONS: readonly string[] = [PROMPT_VERSION];

export interface ModelRating {
  model: string;
  modelKey: string;
  /** Points added over the deterministic manager — the headline eval number. */
  decision: DecisionScore;
  calibration: CalibrationReport;
  /** One line — "well calibrated", "overconfident by 12 points", or too few to judge. */
  calibrationNote: string;
  /** Mean share of the best possible lineup the model actually started, 0..1. */
  lineupSkill: number | null;
  /** Share of all-play matchups won across the season, 0..1. */
  allPlay: number | null;
  weeksScored: number;
}

export interface RatingsBoard {
  season: number;
  rows: ModelRating[];
  /** Forecasts scored, across the league. Zero until a week runs under the new prompt. */
  forecasts: number;
  /** Weeks whose forecasts were excluded because confidence was undefined then. */
  excludedForecasts: number;
  rankingBasis: typeof RANKING_BASIS;
}

const empty = (season: number): RatingsBoard => ({
  season,
  rows: [],
  forecasts: 0,
  excludedForecasts: 0,
  rankingBasis: RANKING_BASIS,
});

export async function loadRatings(season = SEASON): Promise<RatingsBoard> {
  if (!SUPABASE_CONFIGURED) return empty(season);

  const { data: seasonRow } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', season)
    .maybeSingle();
  const seasonId = seasonRow?.id as string | undefined;
  if (!seasonId) return empty(season);

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, models!inner(key, display_name)')
    .eq('season_id', seasonId);
  const teams = (teamRows ?? []) as unknown as {
    id: string;
    models: { key: string; display_name: string };
  }[];
  if (teams.length === 0) return empty(season);

  const teamIds = teams.map((t) => t.id);

  // --- what each team scored, week by week ---------------------------------
  const totals = await loadWeeklyTotals(supabase, teamIds, LAST_LEAGUE_WEEK);

  // --- who played whom ------------------------------------------------------
  const { data: fixtures } = await supabase
    .from('h2h_schedule')
    .select('week, home_team_id, away_team_id')
    .eq('season_id', seasonId);

  const opponentOf = new Map<string, string>();
  for (const f of fixtures ?? []) {
    opponentOf.set(`${f.week}:${f.home_team_id}`, f.away_team_id as string);
    opponentOf.set(`${f.week}:${f.away_team_id}`, f.home_team_id as string);
  }

  // --- what each model forecast --------------------------------------------
  const { data: decisionRows } = await supabase
    .from('decisions')
    .select('team_id, week, confidence, prompt_version')
    .eq('season_id', seasonId)
    .eq('type', 'lineup')
    .not('confidence', 'is', null)
    .not('week', 'is', null);

  const decisions = (decisionRows ?? []) as {
    team_id: string;
    week: number;
    confidence: number;
    prompt_version: string;
  }[];

  const scorable = decisions.filter((d) => CALIBRATED_PROMPT_VERSIONS.includes(d.prompt_version));
  const excluded = decisions.length - scorable.length;

  // --- all-play, per week ---------------------------------------------------
  const allPlayWins = new Map<string, { wins: number; games: number }>();
  for (let week = 1; week <= LEAGUE.regularSeasonWeeks; week++) {
    const scored = teamIds
      .map((id) => ({ teamId: id, points: totals.get(id)?.get(week)?.total }))
      .filter((s): s is { teamId: string; points: number } => s.points !== undefined);
    if (scored.length < 2) continue;

    for (const record of allPlayWeek(scored)) {
      const current = allPlayWins.get(record.teamId) ?? { wins: 0, games: 0 };
      current.wins += record.wins;
      current.games += record.wins + record.losses;
      allPlayWins.set(record.teamId, current);
    }
  }

  // --- lineup efficiency ----------------------------------------------------
  const { data: efficiencyRows } = await supabase
    .from('lineup_scores')
    .select('efficiency, status, lineups!inner(team_id)')
    .in('lineups.team_id', teamIds);

  const efficiencyOf = new Map<string, number[]>();
  for (const row of efficiencyRows ?? []) {
    const teamId = (row.lineups as unknown as { team_id: string }).team_id;
    const list = efficiencyOf.get(teamId) ?? [];
    list.push(Number(row.efficiency ?? 0));
    efficiencyOf.set(teamId, list);
  }

  const deltas = await baselineDeltas(seasonId, season, teamIds, totals);
  const drafts = await draftDeltas(seasonId, season);

  // --- assemble -------------------------------------------------------------
  const rows: ModelRating[] = teams.map((team) => {
    const forecasts: Forecast[] = [];

    for (const decision of scorable.filter((d) => d.team_id === team.id)) {
      const mine = totals.get(team.id)?.get(decision.week)?.total;
      const opponentId = opponentOf.get(`${decision.week}:${team.id}`);
      const theirs = opponentId ? totals.get(opponentId)?.get(decision.week)?.total : undefined;

      // An unscored week is not a loss. Skipping it is the only honest option: a
      // forecast about a game that has not been played cannot be graded.
      if (mine === undefined || theirs === undefined) continue;

      forecasts.push({
        confidence: decision.confidence,
        outcome: mine > theirs ? 1 : mine < theirs ? 0 : 0.5,
      });
    }

    const calibration = calibrate(forecasts);
    const efficiencies = efficiencyOf.get(team.id) ?? [];
    const allPlay = allPlayWins.get(team.id);

    const decision = decisionScore({
      lineup: deltas.get(team.id) ?? [],
      draftDelta: drafts.get(team.id) ?? null,
      calibrationSkill: calibration.skillScore,

      forecasts: calibration.forecasts,
    });

    return {
      model: team.models.display_name,
      modelKey: team.models.key,
      decision,
      calibration,
      calibrationNote: describeCalibration(calibration),
      lineupSkill: efficiencies.length
        ? Number((efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length).toFixed(4))
        : null,
      allPlay: allPlay && allPlay.games > 0
        ? Number((allPlay.wins / allPlay.games).toFixed(4))
        : null,
      weeksScored: efficiencies.length,
    };
  });

  return {
    season,
    // Best forecaster first; a model with none sorts last rather than at the top on a
    // Brier of zero, which is what an empty report would otherwise claim.
    // Ranked on the composite: points added over the manager that is a sort.
    rows: rows.sort((a, b) => b.decision.total - a.decision.total),
    forecasts: rows.reduce((sum, r) => sum + r.calibration.forecasts, 0),
    excludedForecasts: excluded,
    rankingBasis: RANKING_BASIS,
  };
}
