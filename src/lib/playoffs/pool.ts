/**
 * The playoff pool release (SPEC §14.5), as a sequence of writes against the database.
 *
 * The engine half of this already existed and had never been called:
 * `src/lib/engine/playoff-pool.ts` splits the field, releases the rosters and resolves
 * the bids as pure functions. What was missing is the part that decides WHEN, freezes
 * the field, and moves the roster rows.
 *
 * Ordering, which §14.5 fixes and which cannot be rearranged:
 *
 *   week 14 scores  →  seed the field  →  release the eliminated rosters
 *                   →  sealed bids from the four survivors  →  week 15 lineups
 *
 * The release happens BEFORE the bids rather than as part of resolving them, because a
 * model cannot bid on a player it has not been shown. Once the rows are inactive the
 * ordinary free-agent loader picks them up with no special case at all — which is the
 * whole reason this is a roster transaction rather than a parallel "released players"
 * list that every downstream query would have to remember to union in.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { SEMIFINAL_WEEK } from '@/lib/engine/bracket';
import { seedField } from '@/lib/engine/bracket';
import { freezeSeeds, loadFinalStandings, loadStoredSeeds } from './state';

export interface PlayoffFieldResult {
  seeds: string[];
  eliminated: string[];
  /** False when the field was already frozen by an earlier run. */
  frozen: boolean;
}

/**
 * Decide and freeze the four qualifiers.
 *
 * Idempotent on purpose. Vercel cron delivery is best effort and can deliver twice, and
 * the second delivery must not re-seed a bracket the first one already published —
 * particularly since this runs on PROVISIONAL week-14 scores and the numbers underneath
 * it move again on Thursday.
 */
export async function decidePlayoffField(
  db: SupabaseClient,
  seasonId: string,
): Promise<PlayoffFieldResult | null> {
  const standings = await loadFinalStandings(db, seasonId);
  if (standings.length < LEAGUE.teams) return null;

  const existing = await loadStoredSeeds(db, seasonId);
  if (existing.length === LEAGUE.playoffTeams) {
    const qualified = new Set(existing);
    return {
      seeds: existing,
      eliminated: standings
        .filter((row) => !qualified.has(row.teamId))
        .sort((a, b) => a.rank - b.rank)
        .map((row) => row.teamId),
      frozen: false,
    };
  }

  // Throws on a co-ranked cutoff rather than picking one. That is the correct failure:
  // a human has to look, and the alternative is a bracket decided by row order.
  const seeds = seedField(standings);
  const rowOf = new Map(standings.map((row) => [row.teamId, row]));

  await freezeSeeds(
    db,
    seasonId,
    seeds.map((teamId) => {
      const row = rowOf.get(teamId)!;
      return {
        teamId,
        h2hRecord: `${row.h2hW}-${row.h2hL}-${row.h2hT}`,
        cumPts: row.cumPts,
      };
    }),
  );

  const qualified = new Set(seeds);
  return {
    seeds,
    eliminated: standings
      .filter((row) => !qualified.has(row.teamId))
      .sort((a, b) => a.rank - b.rank)
      .map((row) => row.teamId),
    frozen: true,
  };
}

export interface ReleaseResult {
  players: number;
  teams: number;
}

/**
 * Release every player on an eliminated roster into the pool.
 *
 * A drop, using the same columns a mid-season drop uses: the stint is closed with
 * `active = false` and a `dropped_week`, and the row stays. Deleting them would erase
 * fourteen weeks of who-owned-whom from a league whose entire product is the record of
 * what each model did.
 *
 * Idempotent — a second run finds nothing still active and releases nobody.
 */
export async function releaseEliminatedRosters(
  db: SupabaseClient,
  eliminatedTeamIds: string[],
  week = SEMIFINAL_WEEK,
): Promise<ReleaseResult> {
  if (eliminatedTeamIds.length === 0) return { players: 0, teams: 0 };

  const { data, error } = await db
    .from('rosters')
    .update({ active: false, dropped_week: week })
    .in('team_id', eliminatedTeamIds)
    .eq('active', true)
    .select('id, team_id');
  if (error) throw new Error(`playoff release: ${error.message}`);

  const rows = data ?? [];
  return { players: rows.length, teams: new Set(rows.map((r) => r.team_id as string)).size };
}
