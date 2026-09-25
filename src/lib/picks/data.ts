/**
 * Reading fixtures and results for the picks section, from our own tables only (hard
 * rule 6). Shared by the cron job, which builds the DATA block from it, and the site,
 * which grades from it — so the two can never disagree about who won.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { gameKey, gameOutcomes, type Fixture, type GameOutcome } from './grade';

export interface FixtureWithKickoff extends Fixture {
  /** MODELLED earliest kickoff for that weekday — see src/lib/sleeper/kickoff.ts. */
  kickoffAt: string | null;
}

export async function loadFixtures(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<FixtureWithKickoff[]> {
  const { data, error } = await db
    .from('nfl_games')
    .select('home, away, kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .order('kickoff_at', { ascending: true })
    .order('home', { ascending: true });
  if (error) throw new Error(`nfl_games: ${error.message}`);
  return (data ?? []).map((g) => ({
    gameKey: gameKey(g.away as string, g.home as string),
    away: g.away as string,
    home: g.home as string,
    kickoffAt: (g.kickoff_at as string | null) ?? null,
  }));
}

/**
 * What each NFL defence allowed in a week, final where it exists and provisional where
 * it does not (hard rule 3b — never both). A DEF unit's player_id is its team code.
 */
export async function loadPointsAllowed(
  db: SupabaseClient,
  season: number,
  week: number,
  teams: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (teams.length === 0) return out;
  const { data, error } = await db
    .from('player_stats')
    .select('player_id, status, raw_stats')
    .eq('season', season)
    .eq('week', week)
    .in('player_id', teams);
  if (error) throw new Error(`player_stats (DEF): ${error.message}`);

  const final = new Map<string, number>();
  const provisional = new Map<string, number>();
  for (const row of data ?? []) {
    const allowed = (row.raw_stats as Record<string, unknown> | null)?.pts_allow;
    if (typeof allowed !== 'number') continue;
    (row.status === 'final' ? final : provisional).set(row.player_id as string, allowed);
  }
  for (const team of teams) {
    const value = final.get(team) ?? provisional.get(team);
    if (value !== undefined) out.set(team, value);
  }
  return out;
}

export async function loadOutcomes(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<{ fixtures: FixtureWithKickoff[]; outcomes: GameOutcome[] }> {
  const fixtures = await loadFixtures(db, season, week);
  const teams = [...new Set(fixtures.flatMap((f) => [f.away, f.home]))];
  const allowed = await loadPointsAllowed(db, season, week, teams);
  return { fixtures, outcomes: gameOutcomes(fixtures, allowed) };
}
