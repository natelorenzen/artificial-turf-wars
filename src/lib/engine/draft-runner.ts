/**
 * The draft runner (SPEC §4.3, §14.3).
 *
 * Used by BOTH the 2025 backtest and the live draft. That is the point of a backtest:
 * if it exercised a parallel copy of this logic, it would verify the copy.
 *
 * Resumable by construction. Every pick writes a row, and the next pick is derived
 * from what is already stored — so 120 picks can run across many invocations without
 * a single long-lived process, which is what lets the real draft run on a serverless
 * function with a 300s ceiling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE, type Position } from '@/lib/config/league';
import { recordEngineRejection, runDecision } from '@/lib/decisions/run';
import { draftPickSchema } from '@/lib/schemas/decisions';
import { buildDraftBoard, draftBoardNeeds, type DraftBoardPick } from '@/lib/prompt/context';
import {
  fallbackPick,
  narrowAvailable,
  rosterNeeds,
  slotPickNumbers,
  snakeOrder,
  topPerPosition,
  type AvailablePlayer,
  type RosterPlayer,
} from './draft';

export interface DraftTeam {
  teamId: string;
  modelId: string;
  openrouterId: string;
  displayName: string;
  draftSlot: number;
  label: string;
}

export interface DraftState {
  seasonId: string;
  season: number;
  teams: DraftTeam[];
  /** Every pick already made, in order. */
  picks: {
    pickOverall: number;
    round: number;
    teamId: string;
    playerId: string;
    name: string;
    position: Position;
  }[];
  pool: AvailablePlayer[];
}

const OUTPUT_EXAMPLE = {
  pick: 'player_id',
  headline: 'One sentence.',
  key_factors: ['cites a DATA field and value', '...'],
  closest_call: 'The other player seriously considered, and why not.',
  what_would_change_it: 'One sentence.',
  confidence: 0.7,
};

export function rosterFor(state: DraftState, teamId: string): RosterPlayer[] {
  return state.picks
    .filter((p) => p.teamId === teamId)
    .map((p) => ({ playerId: p.playerId, position: p.position }));
}

export function availableFor(state: DraftState): AvailablePlayer[] {
  const taken = new Set(state.picks.map((p) => p.playerId));
  return state.pool.filter((p) => !taken.has(p.playerId));
}

/** The DATA block for one pick. */
export function buildPickContext(state: DraftState, team: DraftTeam, round: number, pickOverall: number) {
  const roster = rosterFor(state, team.teamId);
  const labels = new Map(state.teams.map((t) => [t.teamId, t.label]));
  const board: DraftBoardPick[] = buildDraftBoard(state.picks, labels);

  const { pool, narrowed, missing } = narrowAvailable(availableFor(state), roster, round);

  return {
    data: {
      round,
      pick_overall: pickOverall,
      you_are: team.label,
      your_draft_slot: team.draftSlot,
      your_remaining_picks: slotPickNumbers()[team.draftSlot].filter((n) => n > pickOverall),
      roster_needs: rosterNeeds(roster),
      current_roster: roster.map((p) => {
        const pick = state.picks.find((x) => x.playerId === p.playerId)!;
        return { player_id: p.playerId, name: pick.name, position: p.position };
      }),
      // SPEC §14.3: the board is on the wall in every real draft. With it a model can
      // read positional runs and what rivals still need.
      draft_board: board,
      roster_counts_by_team: draftBoardNeeds(board),
      pool_narrowed: narrowed,
      pool_narrowed_reason: narrowed
        ? `From round ${LEAGUE.softCapRound} your pool is limited to positions you still need: ${missing.join(', ')}`
        : null,
      // Ordered by projection, identically for everyone (SPEC §8.2 list-order bias).
      available: topPerPosition(pool, 8).map((p) => ({
        player_id: p.playerId,
        name: p.name,
        position: p.position,
        proj_season_points: p.projSeasonPoints,
        adp: p.adp ?? null,
      })),
    },
    narrowed,
    legalPool: pool,
    roster,
  };
}

export interface PickResult {
  pickOverall: number;
  round: number;
  team: DraftTeam;
  player: AvailablePlayer;
  fallbackApplied: boolean;
  providerFailure: boolean;
  narrowed: boolean;
  headline: string | null;
  confidence: number | null;
  costUsd: number;
  decisionId: string | null;
}

/**
 * Make one pick. Never throws on a model's bad output — an illegal or missing pick
 * falls back to the highest-projected player that fits an open slot, and the pick is
 * flagged publicly as a model error (SPEC §4.3).
 */
export async function runPick(
  state: DraftState,
  db: SupabaseClient,
  round: number,
  pickOverall: number,
  team: DraftTeam,
): Promise<PickResult> {
  const context = buildPickContext(state, team, round, pickOverall);

  const record = await runDecision(
    {
      seasonId: state.seasonId,
      teamId: team.teamId,
      modelId: team.modelId,
      openrouterId: team.openrouterId,
      type: 'draft_pick',
      round,
      pickOverall,
      data: context.data,
      task:
        `You are ${team.label}, picking at ${pickOverall} overall in round ${round}. ` +
        'Choose exactly one player_id from `available`.',
      outputExample: OUTPUT_EXAMPLE,
      schema: draftPickSchema,
    },
    db,
  );

  const legal = new Map(context.legalPool.map((p) => [p.playerId, p]));
  let player = record.parsed ? legal.get(record.parsed.pick) : undefined;
  let fallbackApplied = false;

  if (!player) {
    player = fallbackPick(availableFor(state), context.roster, round);
    fallbackApplied = true;

    // A pick can be schema-valid and still unusable — a name instead of an id, or a
    // player already off the board. `runDecision` has already written the audit row
    // saying the response parsed, and `/backtest/draft` renders `fallback_applied` from
    // that row, so without this the board would show a deterministic pick as the
    // model's own choice.
    //
    // Audited across the 2025 rehearsal on 6 August 2026: all 120 picks matched what
    // the model named, so nothing was ever mis-reported. That made it true by luck
    // rather than by guard, which is not a property to take into a one-shot draft.
    await recordEngineRejection(
      db,
      record.decisionId,
      record.parsed
        ? `"${record.parsed.pick}" is not an available player id`
        : 'no usable response',
    );
  }

  return {
    pickOverall,
    round,
    team,
    player,
    fallbackApplied,
    providerFailure: record.providerFailure,
    narrowed: context.narrowed,
    headline: record.parsed?.headline ?? null,
    confidence: record.parsed?.confidence ?? null,
    costUsd: record.call.usage.costUsd ?? 0,
    decisionId: record.decisionId,
  };
}

/** Persist a pick and add it to the in-memory state so the next pick sees it. */
export async function commitPick(state: DraftState, db: SupabaseClient, result: PickResult) {
  const { error } = await db.from('draft_picks').insert({
    season_id: state.seasonId,
    round: result.round,
    pick_overall: result.pickOverall,
    team_id: result.team.teamId,
    player_id: result.player.playerId,
    pool_narrowed: result.narrowed,
    decision_id: result.decisionId,
  });
  if (error) throw new Error(`draft_picks: ${error.message}`);

  const { error: rosterError } = await db.from('rosters').insert({
    team_id: result.team.teamId,
    player_id: result.player.playerId,
    acquired_via: 'draft',
    faab_paid: 0,
    active: true,
  });
  if (rosterError) throw new Error(`rosters: ${rosterError.message}`);

  state.picks.push({
    pickOverall: result.pickOverall,
    round: result.round,
    teamId: result.team.teamId,
    playerId: result.player.playerId,
    name: result.player.name,
    position: result.player.position,
  });
}

/** The full 120-pick order, with the team that owns each pick. */
export function draftSchedule(teams: DraftTeam[]) {
  const bySlot = new Map(teams.map((t) => [t.draftSlot, t]));
  return snakeOrder().map((pick) => ({
    ...pick,
    team: bySlot.get(pick.slot)!,
  }));
}

/** Resume point: the first pick number with no stored row. */
export function nextPickNumber(state: DraftState): number {
  const made = new Set(state.picks.map((p) => p.pickOverall));
  const total = LEAGUE.teams * LEAGUE.draftRounds;
  for (let n = 1; n <= total; n++) if (!made.has(n)) return n;
  return total + 1;
}
