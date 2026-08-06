/**
 * Setting one week's eight lineups (SPEC §4.4, §14.3).
 *
 * This is the highest-consequence decision in the season: a lineup that is never set
 * scores zero, and there is no way to go back and set it. Everything below is arranged
 * around that one fact.
 *
 * The order of operations matters more than the code does:
 *
 *   1. Every team without a lineup for the week gets the DETERMINISTIC best-projection
 *      lineup written first, flagged `carried_forward`.
 *   2. Then the models are called, in parallel, and each answer overwrites its team's
 *      seeded row as it lands.
 *
 * So the worst case of a function killed at the 300s ceiling, a provider outage, or a
 * model returning garbage is a team that started its optimal projected lineup and is
 * publicly marked as not having chosen it. The worst case without step 1 is a team
 * scoring nothing. Those are not close, and the seeded row costs one insert.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COHORT, FLEX_ELIGIBLE, LEAGUE } from '@/lib/config/league';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import {
  EMPTY_LINEUP,
  fallbackLineup,
  isStartable,
  lineupPlayerIds,
  validateLineup,
  type Lineup,
  type LineupPlayer,
} from '@/lib/engine/lineup';
import {
  assertOverlayReproducible,
  assertSharedBase,
  hashSplitContext,
  type SplitHashes,
} from '@/lib/prompt/assemble';
import type { RosterEntry } from '@/lib/prompt/context';
import { recordEngineRejection, runDecision } from '@/lib/decisions/run';
import { lineupSchema, type LineupResponse } from '@/lib/schemas/decisions';
import { weeklyBase, weeklyOverlay, type WeeklyContext, type WeeklyTeam } from './context';

/** Lab and model names that must never reach a DATA block (SPEC §14.3). */
export const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

const LINEUP_TASK =
  'Set your starting lineup for this week. Name one player_id for every slot: qb, two rb, ' +
  'two wr, te, flex (RB/WR/TE), k, def. Every id must come from your_roster and must appear ' +
  'in startable_player_ids — a player on bye or ruled out cannot score. No player may fill ' +
  'two slots.\n\n' +
  'If you have NO startable player eligible for a slot, set it to null. That is a legal ' +
  'answer and it scores 0 for that slot, shown publicly as an empty slot. Do not invent an ' +
  'id and do not put an ineligible player there. But null is only accepted when nothing ' +
  'eligible is left — leaving a slot empty while a startable player sits on your bench is ' +
  'rejected, and the deterministic fallback lineup replaces your whole answer.';

const LINEUP_OUTPUT_EXAMPLE = {
  qb: 'player_id',
  rb: ['player_id', 'player_id'],
  wr: ['player_id', 'player_id'],
  te: 'player_id',
  flex: 'player_id',
  k: 'player_id',
  def: 'player_id or null if nothing eligible remains',
  headline: 'One sentence naming the call you actually made.',
  key_factors: ['cites a DATA field and value', '...'],
  closest_call: 'The starter you nearly benched, and what would have made you.',
  what_would_change_it: 'One sentence.',
  confidence: 0.5,
};

// ---------------------------------------------------------------------------
// Roster shaping
// ---------------------------------------------------------------------------

/**
 * The roster as the lineup engine sees it: projections in the `points` field, because
 * a lineup is set against projections and graded against actuals.
 *
 * A null projection becomes 0 here and stays null in the DATA block. Those are not
 * inconsistent — the engine needs a number to sort by, and the model needs to know the
 * number is missing rather than genuinely zero.
 */
export function lineupRoster(entries: RosterEntry[]): LineupPlayer[] {
  return entries.map((entry) => ({
    playerId: entry.player_id,
    position: entry.position as LineupPlayer['position'],
    points: entry.projection ?? 0,
    isOnBye: entry.is_on_bye,
    injuryStatus: entry.injury_status,
  }));
}

/** Ids a model is allowed to name: not on bye, not Out/Inactive/IR (SPEC §4.4). */
export function startableIds(roster: LineupPlayer[]): string[] {
  return roster.filter(isStartable).map((p) => p.playerId).sort();
}

/**
 * The deterministic answer, used whenever a model does not supply a usable one.
 *
 * Built from startable players only. `optimalLineup` filters byes but not injuries,
 * because as the SCORING denominator it must measure the best lineup that could have
 * been set — and a player listed Out on Thursday sometimes plays on Sunday. As a
 * FALLBACK the opposite is true: starting someone we were told is out is a choice
 * nobody made on purpose.
 */
export function deterministicLineup(roster: LineupPlayer[]): Lineup {
  return fallbackLineup(roster.filter(isStartable));
}

// ---------------------------------------------------------------------------
// The DATA block
// ---------------------------------------------------------------------------

export interface LineupContext {
  base: Record<string, unknown>;
  overlay: Record<string, unknown>;
  data: Record<string, unknown>;
  hashes: SplitHashes;
  roster: LineupPlayer[];
}

export function buildLineupContext(context: WeeklyContext, teamId: string): LineupContext {
  const entries = context.rosters.get(teamId) ?? [];
  const roster = lineupRoster(entries);

  const base = weeklyBase(context) as unknown as Record<string, unknown>;
  const overlay = {
    ...(weeklyOverlay(context, teamId) as unknown as Record<string, unknown>),
    startable_player_ids: startableIds(roster),
    slots: LEAGUE.slots,
    flex_eligible: LEAGUE.flexEligible,
  };

  const data = { league: base, you: overlay };
  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);

  return { base, overlay, data, hashes: hashSplitContext({ base, overlay }), roster };
}

/**
 * The §14.6 context proof, run BEFORE the first model call.
 *
 * Deliberately not after. These assertions exist to stop a week going out on unequal
 * data, and a week that has already been paid for eight times is a week nobody is
 * going to throw away. Checking first costs a few milliseconds of pure computation and
 * makes the failure free.
 */
export function assertLineupContexts(context: WeeklyContext): SplitHashes[] {
  const built = context.teams.map((team) => ({
    teamId: team.teamId,
    context: buildLineupContext(context, team.teamId),
  }));

  const hashes = built.map((b) => b.context.hashes);
  assertSharedBase(hashes, `week ${context.week} lineups`);
  assertOverlayReproducible(
    built.map((b) => ({ teamId: b.teamId, overlayHash: b.context.hashes.overlayHash })),
    (teamId) => buildLineupContext(context, teamId).overlay,
    `week ${context.week} lineups`,
  );
  return hashes;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Model response → engine lineup. No repair, no reordering: what it said is what it set. */
export function toLineup(response: LineupResponse): Lineup {
  return {
    qb: response.qb,
    rb: [...response.rb],
    wr: [...response.wr],
    te: response.te,
    flex: response.flex,
    k: response.k,
    def: response.def,
  };
}

/** Which roster positions may legally fill each slot. */
const SLOT_ELIGIBILITY: Record<string, LineupPlayer['position'][]> = {
  qb: ['QB'],
  rb: ['RB'],
  wr: ['WR'],
  te: ['TE'],
  flex: [...FLEX_ELIGIBLE],
  k: ['K'],
  def: ['DEF'],
};

/**
 * An empty slot is legal only when it was unavoidable.
 *
 * Both halves matter. A model with no startable defence must be allowed to say so —
 * that is a real situation the rules anticipate, and 2025 week 6 produced it for three
 * of eight teams with Houston and Minnesota on bye. But a model that leaves FLEX empty
 * with four eligible players on the bench has thrown points away, and recording that as
 * a legal lineup would hide the single most gradeable mistake in the whole game.
 *
 * So the test is availability, not intent: is there a startable player eligible for this
 * slot who is not already starting somewhere else?
 */
export function avoidableEmptySlots(lineup: Lineup, roster: LineupPlayer[]): string[] {
  const used = new Set(lineupPlayerIds(lineup).filter((id): id is string => Boolean(id)));
  const spare = roster.filter((p) => isStartable(p) && !used.has(p.playerId));

  const empties: [string, boolean][] = [
    ['qb', lineup.qb === null],
    ['te', lineup.te === null],
    ['flex', lineup.flex === null],
    ['k', lineup.k === null],
    ['def', lineup.def === null],
    ...lineup.rb.map((id, i): [string, boolean] => [`rb[${i}]`, id === null]),
    ...lineup.wr.map((id, i): [string, boolean] => [`wr[${i}]`, id === null]),
  ];

  const problems: string[] = [];
  for (const [slot, isEmpty] of empties) {
    if (!isEmpty) continue;
    const key = slot.replace(/\[\d+\]$/, '');
    const eligible = spare.filter((p) => SLOT_ELIGIBILITY[key].includes(p.position));
    if (eligible.length > 0) {
      problems.push(
        `${slot} left empty with ${eligible.length} eligible player(s) available ` +
          `(${eligible.slice(0, 3).map((p) => p.playerId).join(', ')})`,
      );
    }
  }
  return problems;
}

/**
 * Legality, on top of the zod shape check.
 *
 * Strict, per the §4.1a policy: everything checked here changes the outcome. A
 * duplicate starter leaves a slot empty, a wrong-position starter is not a lineup at
 * all, and a benched-by-bye starter scores zero — none of them are cosmetic, so all of
 * them fall back rather than being recorded as a soft violation.
 */
export function lineupProblem(lineup: Lineup, roster: LineupPlayer[]): string | null {
  const structural = validateLineup(lineup, roster);
  if (structural) return structural;

  // Empty slots the roster could have filled. Checked before the startability of the
  // named players, because "you benched nobody into your FLEX" is the more basic error.
  const avoidable = avoidableEmptySlots(lineup, roster);
  if (avoidable.length > 0) return avoidable.join('; ');

  const startable = new Set(startableIds(roster));
  const named = lineupPlayerIds(lineup).filter((id): id is string => Boolean(id));
  const unusable = named.filter((id) => !startable.has(id));
  if (unusable.length > 0) {
    const byId = new Map(roster.map((p) => [p.playerId, p]));
    return unusable
      .map((id) => {
        const player = byId.get(id);
        const why = player?.isOnBye ? 'on bye' : `listed ${player?.injuryStatus ?? 'unavailable'}`;
        return `${id} cannot be started (${why})`;
      })
      .join('; ');
  }
  return null;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface LineupDecision {
  team: WeeklyTeam;
  lineup: Lineup;
  decisionId: string | null;
  /** The model produced a legal lineup and it is the one being used. */
  valid: boolean;
  fallbackApplied: boolean;
  providerFailure: boolean;
  problem: string | null;
  headline: string | null;
  confidence: number | null;
  costUsd: number;
  hashes: SplitHashes;
  softViolations: string[];
  unsupportedClaims: string[];
}

export async function decideLineup(
  context: WeeklyContext,
  team: WeeklyTeam,
  db: SupabaseClient | null,
): Promise<LineupDecision> {
  const built = buildLineupContext(context, team.teamId);

  const record = await runDecision<LineupResponse>(
    {
      seasonId: context.seasonId,
      teamId: team.teamId,
      modelId: team.modelId,
      openrouterId: team.openrouterId,
      type: 'lineup',
      week: context.week,
      memoryBlock: context.memoryBlocks.get(team.teamId) ?? null,
      data: built.data,
      task: LINEUP_TASK,
      outputExample: LINEUP_OUTPUT_EXAMPLE,
      schema: lineupSchema,
    },
    db,
  );

  const base = {
    team,
    decisionId: record.decisionId,
    providerFailure: record.providerFailure,
    headline: (record.parsed as { headline?: string } | null)?.headline ?? null,
    confidence: (record.parsed as { confidence?: number } | null)?.confidence ?? null,
    costUsd: record.call.usage.costUsd ?? 0,
    hashes: built.hashes,
    softViolations: record.softViolations,
    unsupportedClaims: record.unsupportedClaims,
  };

  if (!record.parsed) {
    return {
      ...base,
      lineup: deterministicLineup(built.roster),
      valid: false,
      fallbackApplied: true,
      problem: record.call.validationError ?? 'no usable response',
    };
  }

  const lineup = toLineup(record.parsed);
  const problem = lineupProblem(lineup, built.roster);
  if (problem) {
    // The response parsed but is not a legal lineup. Say so on the audit row, or the
    // site publishes this team as having chosen the fallback it was given.
    await recordEngineRejection(db, record.decisionId, problem);
    return {
      ...base,
      lineup: deterministicLineup(built.roster),
      valid: false,
      fallbackApplied: true,
      problem,
    };
  }

  return { ...base, lineup, valid: true, fallbackApplied: false, problem: null };
}

/**
 * All eight, in parallel.
 *
 * The §5.2 "sequential, with a delay" rule is about SLEEPER, whose feed we must not
 * hammer. These are eight different models on eight different upstream providers, and
 * no lineup depends on another — unlike a draft pick, which genuinely does.
 *
 * `allSettled`, not `all`: one provider throwing must cost that team its model call,
 * not cost the other seven their lineups.
 */
export async function decideLineups(
  context: WeeklyContext,
  db: SupabaseClient | null,
): Promise<{ decisions: LineupDecision[]; failures: { team: WeeklyTeam; error: string }[] }> {
  const callable = context.teams.filter((team) => !team.frozen);

  const settled = await Promise.allSettled(
    callable.map((team) => decideLineup(context, team, db)),
  );

  const decisions: LineupDecision[] = [];
  const failures: { team: WeeklyTeam; error: string }[] = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') decisions.push(result.value);
    else {
      failures.push({
        team: callable[i],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { decisions, failures };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function lineupRow(teamId: string, week: number, lineup: Lineup) {
  return {
    team_id: teamId,
    week,
    qb: lineup.qb,
    rb: lineup.rb,
    wr: lineup.wr,
    te: lineup.te,
    flex: lineup.flex,
    k: lineup.k,
    def: lineup.def,
  };
}

/**
 * Give every team a legal lineup BEFORE any model is called.
 *
 * Insert-only: a team that already has a row for this week keeps it. Upserting here
 * would let a re-invocation quietly replace a lineup a model actually chose with the
 * deterministic one, which is the opposite of what this function is for.
 */
export async function seedFallbackLineups(
  db: SupabaseClient,
  context: WeeklyContext,
): Promise<{ seeded: string[] }> {
  const { data, error } = await db
    .from('lineups')
    .select('team_id')
    .eq('week', context.week)
    .in('team_id', context.teams.map((t) => t.teamId));
  if (error) throw new Error(`lineups read: ${error.message}`);

  const existing = new Set((data ?? []).map((row) => row.team_id as string));
  const missing = context.teams.filter((team) => !existing.has(team.teamId));
  if (missing.length === 0) return { seeded: [] };

  const rows = missing.map((team) => {
    const roster = lineupRoster(context.rosters.get(team.teamId) ?? []);
    return {
      ...lineupRow(team.teamId, context.week, roster.length > 0 ? deterministicLineup(roster) : EMPTY_LINEUP),
      // True until a model replaces it. If it is still true after the job finishes,
      // that team's week was decided by code, and the site says so.
      carried_forward: true,
    };
  });

  const { error: insertError } = await db.from('lineups').insert(rows);
  if (insertError) throw new Error(`lineups seed: ${insertError.message}`);
  return { seeded: missing.map((t) => t.teamId) };
}

/** Store one model's answer over its seeded row. */
export async function storeLineup(
  db: SupabaseClient,
  week: number,
  decision: LineupDecision,
  lockedAt: Date,
): Promise<void> {
  const { error } = await db
    .from('lineups')
    .update({
      ...lineupRow(decision.team.teamId, week, decision.lineup),
      // A fallback lineup was not carried forward from anywhere — it was computed for
      // this week from this roster. Conflating the two would misreport why.
      carried_forward: false,
      decision_id: decision.decisionId,
      locked_at: lockedAt.toISOString(),
    })
    .eq('team_id', decision.team.teamId)
    .eq('week', week);
  if (error) throw new Error(`lineups update (team ${decision.team.teamId}): ${error.message}`);
}
