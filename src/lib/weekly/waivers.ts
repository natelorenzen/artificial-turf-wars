/**
 * Tuesday's sealed FAAB bids (SPEC §4.5, §14.3).
 *
 * The models decide here; `waiver-resolve` applies the published rule to what they
 * decided on Wednesday. Keeping those two jobs a day and a table apart is what makes
 * the auction checkable: every bid is stored before any of them is resolved, so
 * nobody's number can have been informed by anybody else's.
 *
 * The single budget is the whole game (SPEC §4.2). What a model did not spend on its
 * draft slot in August is the same money it is spending here in week 7 and the same
 * money it will need for the playoff free-agent pool in week 15. A bid is therefore
 * never just a price — it is a claim about the rest of the season, which is exactly
 * the reasoning this project exists to publish.
 *
 * `claims: []` is a valid answer and writes nothing. That is why the idempotency guard
 * is a `job_runs` claim rather than "does this team have rows for this week" — standing
 * pat and never running look identical in `waiver_bids`, and always will.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE, type Position } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import { validateWaiverClaims, type TeamWaiverState, type WaiverClaim } from '@/lib/engine/faab';
import {
  assertOverlayReproducible,
  assertSharedBase,
  hashSplitContext,
  type SplitHashes,
} from '@/lib/prompt/assemble';
import { mean, type RosterEntry } from '@/lib/prompt/context';
import { runDecision } from '@/lib/decisions/run';
import { waiverSchema, type WaiverResponse } from '@/lib/schemas/decisions';
import {
  loadPlayerForm,
  weeklyBase,
  weeklyOverlay,
  type WeeklyContext,
  type WeeklyTeam,
} from './context';

export const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

/** How many free agents are shown, by projection. Deep enough to have a real choice in. */
export const POOL_SIZE = 60;

/**
 * K and DEF are added on top of the projection-ranked pool rather than competing for
 * places in it. Streaming a defence against a bad offence is a recognised strategy the
 * evaluation explicitly grades (`def_stream_hit`), and a pool ordered purely by
 * projected points would show almost no kickers or defences at all — which would
 * measure our pool construction rather than the model's judgement.
 */
export const STREAMING_SLOTS: Position[] = ['K', 'DEF'];
export const STREAMING_PER_POSITION = 8;

/**
 * The "no two claims may drop the same player" line was NOT in the first version, and
 * the 2025 week-5 rehearsal showed what that costs.
 *
 * One model filed several claims all dropping the same tight end — a contingency set,
 * and a perfectly sensible one in a league that supports conditional claims. Ours does
 * not: every claim resolves independently, so two claims dropping the same player would
 * drop him twice and leave the roster a man short. Validation rejected the whole set and
 * the model got nothing.
 *
 * It was never told. Rejecting a model for breaking a rule that appears nowhere in its
 * prompt measures our prompt, not its reasoning, and would have been published as the
 * latter. The rule was always enforced in `validateWaiverClaims`; now it is also stated.
 */
const WAIVER_TASK =
  'Submit your sealed FAAB claims for this week, or none. Every claim adds one player from ' +
  'available_players and drops one from your_roster, so your roster stays at ' +
  `${LEAGUE.rosterSize}. Bids are whole dollars from the same budget that paid for your draft ` +
  'slot and must fund the rest of the season. Highest bid wins; ties break on waiver_priority ' +
  '(lower is better). Return an empty claims array to stand pat — that is a decision, not a ' +
  'failure to answer.\n\n' +
  'Claims are NOT conditional on each other. Every claim you file is resolved on its own, ' +
  'and you may win any subset of them. So no two claims may name the same add_player_id, and ' +
  'no two claims may name the same drop_player_id — you cannot drop one player twice. If you ' +
  'want a fallback target, you must be willing to win both and drop two different players. ' +
  'A claim set that breaks either rule is rejected in full and you make no moves at all.';

const WAIVER_OUTPUT_EXAMPLE = {
  claims: [
    {
      add_player_id: 'player_id from available_players',
      drop_player_id: 'player_id from your_roster',
      bid: 7,
      reasoning: 'One sentence on why this player at this price.',
    },
  ],
  headline: 'One sentence naming what you did.',
  key_factors: ['cites a DATA field and value', '...'],
  closest_call: 'The claim or price you nearly chose instead.',
  what_would_change_it: 'One sentence.',
  confidence: 0.5,
};

// ---------------------------------------------------------------------------
// The free-agent pool
// ---------------------------------------------------------------------------

/**
 * Everybody not on a roster, with this week's projection and recent form.
 *
 * Reads our own snapshot tables only, like every other decision-time path — the pool a
 * model saw on a Tuesday in October has to be reconstructible in March.
 */
export async function loadFreeAgents(
  db: SupabaseClient,
  context: WeeklyContext,
  limit = POOL_SIZE,
): Promise<RosterEntry[]> {
  const rostered = new Set<string>();
  for (const list of context.rosters.values()) {
    for (const entry of list) rostered.add(entry.player_id);
  }

  // Over-fetch: the top of the projection board is mostly rostered players, and
  // filtering after the fact is the only way to get `limit` genuine free agents.
  const { data, error } = await db
    .from('player_projections')
    .select('player_id, proj_pts, players!inner(name, position, nfl_team, injury_status)')
    .eq('season', context.season)
    .eq('week', context.week)
    .not('proj_pts', 'is', null)
    .order('proj_pts', { ascending: false })
    .limit(limit * 6 + rostered.size);
  if (error) throw new Error(`player_projections: ${error.message}`);

  const byes = new Set(context.byeTeams);
  const candidates = (data ?? [])
    .filter((row) => !rostered.has(row.player_id as string))
    .map((row) => {
      const player = row.players as unknown as {
        name: string;
        position: Position;
        nfl_team: string | null;
        injury_status: string | null;
      };
      return {
        player_id: row.player_id as string,
        name: player.name,
        position: player.position,
        nfl_team: player.nfl_team,
        projection: round2(Number(row.proj_pts)),
        season_ppg: null as number | null,
        last3_ppg: null as number | null,
        injury_status: player.injury_status,
        is_on_bye: player.nfl_team ? byes.has(player.nfl_team) : false,
      };
    });

  const chosen = candidates.slice(0, limit);
  const taken = new Set(chosen.map((p) => p.player_id));
  for (const position of STREAMING_SLOTS) {
    for (const player of candidates.filter((p) => p.position === position)) {
      if (taken.has(player.player_id)) continue;
      if (chosen.filter((p) => p.position === position).length >= STREAMING_PER_POSITION) break;
      chosen.push(player);
      taken.add(player.player_id);
    }
  }

  const form = await loadPlayerForm(
    db,
    context.season,
    context.week,
    chosen.map((p) => p.player_id),
  );
  for (const player of chosen) {
    const history = form.get(player.player_id) ?? [];
    player.season_ppg = mean(history);
    player.last3_ppg = mean(history.slice(-3));
  }

  // Stable order, or the shared base hash changes between two identical loads.
  return chosen.sort((a, b) =>
    b.projection! - a.projection! || (a.player_id < b.player_id ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------
// The DATA block
// ---------------------------------------------------------------------------

export interface WaiverContextInput {
  context: WeeklyContext;
  freeAgents: RosterEntry[];
  /** The week the bids are filed under — the week just played. */
  bidWeek: number;
}

export interface WaiverDataBlock {
  base: Record<string, unknown>;
  overlay: Record<string, unknown>;
  data: Record<string, unknown>;
  hashes: SplitHashes;
}

export function buildWaiverContext(input: WaiverContextInput, teamId: string): WaiverDataBlock {
  const { context, freeAgents } = input;

  const base = {
    ...(weeklyBase(context) as unknown as Record<string, unknown>),
    effective_week: context.week,
    available_players: freeAgents,
    budget_total: LEAGUE.budgetTotal,
    roster_size: LEAGUE.rosterSize,
    // Rival rosters, by anonymous label. A model cannot judge whether a running back
    // is worth $12 without knowing who else needs one (SPEC §14.3).
    league_rosters: [...context.rosters.entries()]
      .map(([id, list]) => ({
        label: context.labels.get(id) ?? 'Unknown',
        faab_remaining: context.teams.find((t) => t.teamId === id)?.faabRemaining ?? 0,
        roster: list.map((p) => ({ player_id: p.player_id, name: p.name, position: p.position })),
      }))
      .sort((a, b) => (a.label < b.label ? -1 : 1)),
    tiebreak_rule:
      'Highest bid wins. Equal bids break on waiver_priority, lowest first. A winning claim ' +
      'drops that team to the bottom of the priority list, within the same run.',
  };

  const overlay = weeklyOverlay(context, teamId) as unknown as Record<string, unknown>;

  const data = { league: base, you: overlay };
  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);

  return { base, overlay, data, hashes: hashSplitContext({ base, overlay }) };
}

/** The §14.6 proof, run before the first model call — see the note in `lineups.ts`. */
export function assertWaiverContexts(input: WaiverContextInput): SplitHashes[] {
  const built = input.context.teams.map((team) => ({
    teamId: team.teamId,
    block: buildWaiverContext(input, team.teamId),
  }));

  const hashes = built.map((b) => b.block.hashes);
  assertSharedBase(hashes, `week ${input.bidWeek} waivers`);
  assertOverlayReproducible(
    built.map((b) => ({ teamId: b.teamId, overlayHash: b.block.hashes.overlayHash })),
    (teamId) => buildWaiverContext(input, teamId).overlay,
    `week ${input.bidWeek} waivers`,
  );
  return hashes;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface WaiverDecision {
  team: WeeklyTeam;
  claims: WaiverClaim[];
  reasons: string[];
  decisionId: string | null;
  valid: boolean;
  /**
   * True when the model's claims were dropped wholesale.
   *
   * The fallback for waivers is to do NOTHING. There is no deterministic "best claim"
   * that would be honest to attribute to a model, and inventing a transaction it did
   * not ask for would spend its money on our judgement (SPEC §4.5).
   */
  fallbackApplied: boolean;
  providerFailure: boolean;
  problem: string | null;
  headline: string | null;
  confidence: number | null;
  costUsd: number;
  hashes: SplitHashes;
}

export function teamWaiverState(context: WeeklyContext, team: WeeklyTeam): TeamWaiverState {
  return {
    teamId: team.teamId,
    faabRemaining: team.faabRemaining,
    waiverPriority: team.waiverPriority,
    roster: (context.rosters.get(team.teamId) ?? []).map((p) => p.player_id),
  };
}

export async function decideWaivers(
  input: WaiverContextInput,
  team: WeeklyTeam,
  db: SupabaseClient | null,
): Promise<WaiverDecision> {
  const { context, freeAgents, bidWeek } = input;
  const block = buildWaiverContext(input, team.teamId);

  const record = await runDecision<WaiverResponse>(
    {
      seasonId: context.seasonId,
      teamId: team.teamId,
      modelId: team.modelId,
      openrouterId: team.openrouterId,
      type: 'waiver',
      week: bidWeek,
      memoryBlock: context.memoryBlocks.get(team.teamId) ?? null,
      data: block.data,
      task: WAIVER_TASK,
      outputExample: WAIVER_OUTPUT_EXAMPLE,
      schema: waiverSchema,
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
    hashes: block.hashes,
  };

  if (!record.parsed) {
    return {
      ...base,
      claims: [],
      reasons: [],
      valid: false,
      fallbackApplied: true,
      problem: record.call.validationError ?? 'no usable response',
    };
  }

  const claims: WaiverClaim[] = record.parsed.claims.map((c) => ({
    teamId: team.teamId,
    addPlayerId: c.add_player_id,
    dropPlayerId: c.drop_player_id,
    bid: c.bid,
  }));

  const problem = validateWaiverClaims(
    claims,
    teamWaiverState(context, team),
    new Set(freeAgents.map((p) => p.player_id)),
  );
  if (problem) {
    // All or nothing, per §4.5: partially applying a claim set changes the plan the
    // model actually submitted into one it never considered.
    return { ...base, claims: [], reasons: [], valid: false, fallbackApplied: true, problem };
  }

  return {
    ...base,
    claims,
    reasons: record.parsed.claims.map((c) => c.reasoning),
    valid: true,
    fallbackApplied: false,
    problem: null,
  };
}

/** All eight in parallel — see the note on `decideLineups`. */
export async function decideAllWaivers(
  input: WaiverContextInput,
  db: SupabaseClient | null,
): Promise<{ decisions: WaiverDecision[]; failures: { team: WeeklyTeam; error: string }[] }> {
  const callable = input.context.teams.filter((team) => !team.frozen);

  const settled = await Promise.allSettled(
    callable.map((team) => decideWaivers(input, team, db)),
  );

  const decisions: WaiverDecision[] = [];
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

/**
 * Store one team's sealed bids.
 *
 * `won` and `losing_reason` stay at their defaults: nothing is resolved until
 * Wednesday, and writing an outcome here would mean this job had decided one.
 */
export async function storeWaiverBids(
  db: SupabaseClient,
  bidWeek: number,
  decision: WaiverDecision,
): Promise<void> {
  if (decision.claims.length === 0) return;

  const { error } = await db.from('waiver_bids').upsert(
    decision.claims.map((claim, i) => ({
      team_id: decision.team.teamId,
      week: bidWeek,
      add_player_id: claim.addPlayerId,
      drop_player_id: claim.dropPlayerId,
      bid: claim.bid,
      reasoning: decision.reasons[i] ?? null,
      decision_id: decision.decisionId,
    })),
    { onConflict: 'team_id,week,add_player_id' },
  );
  if (error) throw new Error(`waiver_bids (team ${decision.team.teamId}): ${error.message}`);
}
