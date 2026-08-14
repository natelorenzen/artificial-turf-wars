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
import { SEASON } from './results';

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

    return {
      model: team.models.display_name,
      modelKey: team.models.key,
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
    rows: rows.sort((a, b) => {
      if (a.calibration.forecasts === 0 && b.calibration.forecasts === 0) {
        return (b.lineupSkill ?? 0) - (a.lineupSkill ?? 0);
      }
      if (a.calibration.forecasts === 0) return 1;
      if (b.calibration.forecasts === 0) return -1;
      return a.calibration.brier - b.calibration.brier;
    }),
    forecasts: rows.reduce((sum, r) => sum + r.calibration.forecasts, 0),
    excludedForecasts: excluded,
    rankingBasis: RANKING_BASIS,
  };
}
