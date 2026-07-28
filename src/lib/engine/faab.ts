/**
 * FAAB waiver resolution (SPEC §4.5).
 *
 * Sealed bids, highest wins, ties break on the continual rolling list seeded in
 * reverse draft-slot order — exactly Yahoo's tiebreak. A successful claim drops that
 * team to the bottom of the list, and that drop affects later ties in the SAME run,
 * which is why claims are processed one at a time in a stated order rather than
 * grouped per player.
 *
 * Losing bids are kept, not discarded: a model that bid $40 and lost to $41 is
 * showing its valuation just as clearly as the winner (SPEC §5.4).
 */

import { LEAGUE } from '@/lib/config/league';

export interface WaiverClaim {
  teamId: string;
  addPlayerId: string;
  dropPlayerId: string;
  bid: number;
}

export interface TeamWaiverState {
  teamId: string;
  faabRemaining: number;
  waiverPriority: number;
  /** Active roster player ids, used to check the drop is legal. */
  roster: string[];
}

export type LosingReason =
  | 'outbid'
  | 'tiebreak'
  | 'insufficient_budget'
  | 'player_already_claimed'
  | 'invalid_drop'
  | 'duplicate_add';

export interface WaiverOutcome extends WaiverClaim {
  won: boolean;
  losingReason: LosingReason | null;
}

export interface WaiverResolution {
  outcomes: WaiverOutcome[];
  /** Post-run state: budgets debited, rolling list rotated, rosters mutated. */
  teams: TeamWaiverState[];
}

/**
 * Resolve one week's waiver run.
 *
 * Processing order is deterministic and published: bid descending, then current
 * waiver priority ascending, then player id, then team id. Every tiebreak is
 * replayable from the stored bids alone.
 */
export function resolveWaivers(claims: WaiverClaim[], teams: TeamWaiverState[]): WaiverResolution {
  const state = new Map(teams.map((t) => [t.teamId, { ...t, roster: [...t.roster] }]));
  const spentThisRun = new Map<string, number>();
  const claimedPlayers = new Set<string>();
  const addedByTeam = new Map<string, Set<string>>();
  const outcomes: WaiverOutcome[] = [];

  const ordered = [...claims].sort((a, b) => {
    if (a.bid !== b.bid) return b.bid - a.bid;
    const pa = state.get(a.teamId)?.waiverPriority ?? Number.MAX_SAFE_INTEGER;
    const pb = state.get(b.teamId)?.waiverPriority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    if (a.addPlayerId !== b.addPlayerId) return a.addPlayerId < b.addPlayerId ? -1 : 1;
    return a.teamId < b.teamId ? -1 : 1;
  });

  for (const claim of ordered) {
    const team = state.get(claim.teamId);
    const fail = (reason: LosingReason) => outcomes.push({ ...claim, won: false, losingReason: reason });

    if (!team) {
      fail('invalid_drop');
      continue;
    }

    if (claimedPlayers.has(claim.addPlayerId)) {
      // Someone above in the processing order already took him. Whether that was a
      // higher bid or the rolling list is exactly what the reason field records.
      const winner = outcomes.find((o) => o.won && o.addPlayerId === claim.addPlayerId);
      fail(winner && winner.bid === claim.bid ? 'tiebreak' : 'outbid');
      continue;
    }

    const alreadyAdded = addedByTeam.get(claim.teamId) ?? new Set<string>();
    if (alreadyAdded.has(claim.addPlayerId)) {
      fail('duplicate_add');
      continue;
    }

    if (!team.roster.includes(claim.dropPlayerId)) {
      fail('invalid_drop');
      continue;
    }

    const spent = spentThisRun.get(claim.teamId) ?? 0;
    if (claim.bid > team.faabRemaining - spent) {
      fail('insufficient_budget');
      continue;
    }

    // Won.
    claimedPlayers.add(claim.addPlayerId);
    alreadyAdded.add(claim.addPlayerId);
    addedByTeam.set(claim.teamId, alreadyAdded);
    spentThisRun.set(claim.teamId, spent + claim.bid);

    team.roster = team.roster.filter((id) => id !== claim.dropPlayerId).concat(claim.addPlayerId);
    outcomes.push({ ...claim, won: true, losingReason: null });
  }

  // Debit budgets, then rotate the rolling list: every team that won a claim drops
  // to the bottom, preserving relative order among winners and among non-winners.
  const winners = new Set(outcomes.filter((o) => o.won).map((o) => o.teamId));
  const remaining = [...state.values()];
  for (const team of remaining) {
    team.faabRemaining -= spentThisRun.get(team.teamId) ?? 0;
  }

  const nonWinners = remaining
    .filter((t) => !winners.has(t.teamId))
    .sort((a, b) => a.waiverPriority - b.waiverPriority);
  const wonTeams = remaining
    .filter((t) => winners.has(t.teamId))
    .sort((a, b) => a.waiverPriority - b.waiverPriority);

  [...nonWinners, ...wonTeams].forEach((team, index) => {
    team.waiverPriority = index + 1;
  });

  return { outcomes, teams: remaining.sort((a, b) => a.waiverPriority - b.waiverPriority) };
}

/**
 * Pre-flight validation of one model's waiver response (SPEC §4.5).
 *
 * On failure we apply NO claims for that team and flag it — the fallback must never
 * invent a transaction the model did not ask for.
 */
export function validateWaiverClaims(
  claims: WaiverClaim[],
  team: TeamWaiverState,
  availableIds: Set<string>,
): string | null {
  const total = claims.reduce((sum, c) => sum + c.bid, 0);
  if (total > team.faabRemaining) {
    return `bids total $${total} but only $${team.faabRemaining} remains`;
  }
  if (claims.some((c) => c.bid < 0 || c.bid > LEAGUE.budgetTotal || !Number.isInteger(c.bid))) {
    return 'a bid is not a whole number in range';
  }

  const adds = claims.map((c) => c.addPlayerId);
  const drops = claims.map((c) => c.dropPlayerId);
  if (new Set(adds).size !== adds.length) return 'duplicate add';
  if (new Set(drops).size !== drops.length) return 'duplicate drop';

  for (const c of claims) {
    if (!availableIds.has(c.addPlayerId)) return `${c.addPlayerId} is not available`;
    if (!team.roster.includes(c.dropPlayerId)) return `${c.dropPlayerId} is not on the roster`;
  }

  // Every claim is add-and-drop, so the roster stays at exactly 15 by construction.
  if (team.roster.length !== LEAGUE.rosterSize) {
    return `roster is ${team.roster.length}, expected ${LEAGUE.rosterSize}`;
  }
  return null;
}

/** `$ per point added` normalises waiver ROI across unequal budgets (SPEC §4.2). */
export function dollarsPerPoint(faabSpent: number, netPointsGained: number): number | null {
  if (netPointsGained <= 0) return null;
  return Number((faabSpent / netPointsGained).toFixed(2));
}
