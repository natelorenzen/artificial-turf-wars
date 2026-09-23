/**
 * NFL picks, as the site shows them: every model's pick for every game, graded against
 * the final score, and a season board of who is actually any good at it.
 *
 * Grades are computed here from `player_stats`, never stored (see src/lib/picks/grade.ts),
 * so this module and the cron job share one definition of who won a game.
 */

import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';
import { SEASON } from '@/lib/site/results';
import { loadOutcomes } from '@/lib/picks/data';
import {
  consensusPicks,
  gradePick,
  homeTeamPicks,
  tally,
  type ConsensusPick,
  type GameOutcome,
  type Pick,
  type PickResult,
  type PickTally,
} from '@/lib/picks/grade';

export interface ModelPickView extends Pick {
  reason: string | null;
  result: PickResult;
}

export interface ModelPickSet {
  model: string;
  modelKey: string;
  headline: string | null;
  valid: boolean;
  providerFailure: boolean;
  validationError: string | null;
  rawResponse: string | null;
  contextHash: string;
  lockedAt: string;
  picks: Map<string, ModelPickView>;
  tally: PickTally;
}

export interface PicksWeek {
  week: number;
  outcomes: GameOutcome[];
  sets: ModelPickSet[];
  consensus: (ConsensusPick & { result: PickResult })[];
  consensusTally: PickTally;
  homeTally: PickTally;
  /** One hash when every model saw the same block, which is the design. */
  contextHashes: string[];
  systemPrompt: string | null;
  userPrompt: string | null;
}

export interface BoardRow {
  model: string;
  modelKey: string;
  tally: PickTally;
  weeks: number;
}

async function seasonId(season: number): Promise<string | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const { data } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Weeks with at least one stored pick set, newest first. Empty if the table is absent. */
export async function pickWeeks(season = SEASON): Promise<number[]> {
  const id = await seasonId(season);
  if (!id) return [];
  const { data, error } = await supabase.from('pick_sets').select('week').eq('season_id', id);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.week as number))].sort((a, b) => b - a);
}

export async function loadPicksWeek(week: number, season = SEASON): Promise<PicksWeek | null> {
  const id = await seasonId(season);
  if (!id) return null;

  const { data: setRows, error } = await supabase
    .from('pick_sets')
    .select(
      'id, model_id, headline, valid, provider_failure, validation_error, raw_response, context_hash, locked_at, system_prompt, user_prompt, models(key, display_name)',
    )
    .eq('season_id', id)
    .eq('week', week);
  if (error || !setRows || setRows.length === 0) return null;

  const { data: pickRows } = await supabase
    .from('game_picks')
    .select('model_id, game_key, pick, win_prob, reason')
    .eq('season_id', id)
    .eq('week', week);

  const { fixtures, outcomes } = await loadOutcomes(supabase, season, week);
  const byGame = new Map(outcomes.map((o) => [o.gameKey, o]));

  const sets: ModelPickSet[] = setRows.map((row) => {
    const model = row.models as unknown as { key: string; display_name: string };
    const picks = new Map<string, ModelPickView>();
    for (const p of pickRows ?? []) {
      if (p.model_id !== row.model_id) continue;
      const pick: Pick = { gameKey: p.game_key as string, pick: p.pick as string, winProb: Number(p.win_prob) };
      picks.set(pick.gameKey, { ...pick, reason: (p.reason as string | null) ?? null, result: gradePick(pick, byGame.get(pick.gameKey)) });
    }
    return {
      model: model.display_name,
      modelKey: model.key,
      headline: (row.headline as string | null) ?? null,
      valid: row.valid as boolean,
      providerFailure: row.provider_failure as boolean,
      validationError: (row.validation_error as string | null) ?? null,
      rawResponse: (row.raw_response as string | null) ?? null,
      contextHash: row.context_hash as string,
      lockedAt: row.locked_at as string,
      picks,
      tally: tally([...picks.values()], byGame),
    };
  });

  sets.sort((a, b) => {
    const acc = (b.tally.accuracy ?? -1) - (a.tally.accuracy ?? -1);
    if (acc !== 0) return acc;
    const br = (a.tally.brier ?? 9) - (b.tally.brier ?? 9);
    return br !== 0 ? br : a.model.localeCompare(b.model);
  });

  const consensus = consensusPicks(fixtures, sets.map((s) => [...s.picks.values()]));
  const first = setRows[0];

  return {
    week,
    outcomes,
    sets,
    consensus: consensus.map((c) => ({ ...c, result: gradePick(c, byGame.get(c.gameKey)) })),
    consensusTally: tally(consensus, byGame),
    homeTally: tally(homeTeamPicks(fixtures), byGame),
    contextHashes: [...new Set(setRows.map((r) => r.context_hash as string))],
    systemPrompt: (first.system_prompt as string | null) ?? null,
    userPrompt: (first.user_prompt as string | null) ?? null,
  };
}

/** The season board: every model's picks across every week, plus the two baselines. */
export async function loadPicksBoard(season = SEASON): Promise<{
  rows: BoardRow[];
  consensus: PickTally;
  home: PickTally;
  weeks: number[];
} | null> {
  const weeks = await pickWeeks(season);
  if (weeks.length === 0) return null;

  const loaded = (await Promise.all(weeks.map((w) => loadPicksWeek(w, season)))).filter(
    (w): w is PicksWeek => w !== null,
  );

  const sum = (tallies: PickTally[]): PickTally => {
    const t = tallies.reduce(
      (acc, x) => {
        const decided = x.won + x.lost + x.push;
        acc.won += x.won;
        acc.lost += x.lost;
        acc.push += x.push;
        acc.pending += x.pending;
        acc.brierSum += (x.brier ?? 0) * decided;
        acc.confSum += (x.meanConfidence ?? 0) * decided;
        acc.decided += decided;
        return acc;
      },
      { won: 0, lost: 0, push: 0, pending: 0, brierSum: 0, confSum: 0, decided: 0 },
    );
    return {
      won: t.won,
      lost: t.lost,
      push: t.push,
      pending: t.pending,
      accuracy: t.won + t.lost > 0 ? t.won / (t.won + t.lost) : null,
      brier: t.decided > 0 ? t.brierSum / t.decided : null,
      meanConfidence: t.decided > 0 ? t.confSum / t.decided : null,
    };
  };

  const byModel = new Map<string, { model: string; tallies: PickTally[] }>();
  for (const week of loaded) {
    for (const set of week.sets) {
      const entry = byModel.get(set.modelKey) ?? { model: set.model, tallies: [] };
      entry.tallies.push(set.tally);
      byModel.set(set.modelKey, entry);
    }
  }

  const rows: BoardRow[] = [...byModel].map(([modelKey, { model, tallies }]) => ({
    model,
    modelKey,
    tally: sum(tallies),
    weeks: tallies.length,
  }));
  rows.sort((a, b) => {
    const br = (a.tally.brier ?? 9) - (b.tally.brier ?? 9);
    if (br !== 0) return br;
    return (b.tally.accuracy ?? -1) - (a.tally.accuracy ?? -1);
  });

  return {
    rows,
    consensus: sum(loaded.map((w) => w.consensusTally)),
    home: sum(loaded.map((w) => w.homeTally)),
    weeks,
  };
}
