/**
 * The playoff pool release (SPEC §14.5).
 *
 * After Week 14, every player on the four eliminated rosters is released into a
 * free-agent pool, and the four survivors bid their remaining FAAB on them in one
 * final waiver run. Eliminated teams stop setting lineups.
 *
 * This is what makes fourteen weeks of budget discipline pay off: a team that hoarded
 * gets a two-week superteam, a team that spent to survive arrives with nothing. It
 * also forces a genuinely different question onto four models at once — what do I
 * need for TWO GAMES, not a season — where bye weeks stop mattering, rest-of-season
 * projections stop mattering, and only weeks 15 and 16 count.
 */

import { LEAGUE } from '@/lib/config/league';
import { resolveWaivers, type TeamWaiverState, type WaiverClaim, type WaiverResolution } from './faab';
import type { StandingRow } from './allplay';

export interface PlayoffField {
  qualified: string[];
  eliminated: string[];
}

/** Top N by the standings order the site has shown all season (SPEC §14.2). */
export function splitPlayoffField(standings: StandingRow[]): PlayoffField {
  const ranked = [...standings].sort((a, b) => a.rank - b.rank || (a.teamId < b.teamId ? -1 : 1));

  // A co-ranked team at the cutoff would make the field ambiguous. The commissioner
  // is deterministic, so refuse rather than silently picking one.
  const cutoff = ranked[LEAGUE.playoffTeams - 1];
  const next = ranked[LEAGUE.playoffTeams];
  if (cutoff && next && cutoff.rank === next.rank) {
    throw new Error(
      `playoff field is ambiguous: ${cutoff.teamId} and ${next.teamId} are co-ranked at ` +
        `the ${LEAGUE.playoffTeams}-seed cutoff. Resolve before releasing the pool.`,
    );
  }

  return {
    qualified: ranked.slice(0, LEAGUE.playoffTeams).map((r) => r.teamId),
    eliminated: ranked.slice(LEAGUE.playoffTeams).map((r) => r.teamId),
  };
}

export interface ReleasedPlayer {
  playerId: string;
  fromTeamId: string;
}

/** Every player on an eliminated roster becomes available. */
export function releaseEliminatedRosters(
  field: PlayoffField,
  rosters: { teamId: string; playerId: string }[],
): ReleasedPlayer[] {
  const eliminated = new Set(field.eliminated);
  return rosters
    .filter((entry) => eliminated.has(entry.teamId))
    .map((entry) => ({ playerId: entry.playerId, fromTeamId: entry.teamId }))
    .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
}

/**
 * The playoff waiver run. Mechanically identical to the weekly FAAB run — same
 * sealed bids, same rolling-list tiebreak, same add-and-drop atomicity — with two
 * differences: only qualified teams may bid, and the pool includes the released
 * players as well as anyone already unrostered.
 */
export function resolvePlayoffPool(
  claims: WaiverClaim[],
  teams: TeamWaiverState[],
  field: PlayoffField,
): WaiverResolution & { rejected: WaiverClaim[] } {
  const qualified = new Set(field.qualified);

  const eligible = claims.filter((claim) => qualified.has(claim.teamId));
  const rejected = claims.filter((claim) => !qualified.has(claim.teamId));

  const resolution = resolveWaivers(
    eligible,
    teams.filter((team) => qualified.has(team.teamId)),
  );

  return { ...resolution, rejected };
}

/**
 * Availability for the two playoff weeks only. Rest-of-season projections and bye
 * weeks after Week 16 are irrelevant here, and a model reasoning from them is
 * reasoning about a season that has already ended.
 */
export function playoffRelevantWeeks(): readonly number[] {
  return LEAGUE.playoffWeeks;
}
