/**
 * How good was each model's DRAFT, judged independently of how its season went?
 *
 *   npx tsx --env-file=.env.local scripts/draft-eval.ts --season 2025
 *
 * Read-only. No model calls, no writes.
 *
 * ---------------------------------------------------------------------------
 * Why total points drafted is the wrong answer
 * ---------------------------------------------------------------------------
 * The team picking first gets a better player than the team picking eighth, every
 * round, by construction. Ranking on points drafted mostly ranks the auction, which
 * the models already paid for and which is not the thing being measured.
 *
 * So the headline number here is CAPTURE RATE: at each pick, what the player taken
 * went on to score, against the best player still on the board at that moment. A team
 * drafting eighth faces a worse board and is graded against that worse board. Every
 * model is judged against the same standard — perfect hindsight — at the exact
 * position it actually picked from.
 *
 * Hindsight is the point, not a flaw. Nobody could have known; the question is who got
 * closest, and every model faced the identical unknowable.
 *
 * STARTERS VALUE is the second number, and it catches what capture rate cannot:
 * roster construction. A team can take the highest scorer available fifteen times and
 * field an illegal lineup, because the league starts a kicker and a defence. This runs
 * the same optimal-lineup solver the scoring engine uses, over actual season points.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE, type Position } from '@/lib/config/league';
import { optimalLineup, type LineupPlayer } from '@/lib/engine/lineup';

const argValue = (name: string): string | null => {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const SEASON = Number(argValue('season') ?? 2025);

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Season points per player, summed over the fantasy regular season only. */
async function seasonPoints(supabase: SupabaseClient): Promise<Map<string, number>> {
  const totals = new Map<string, number>();

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('player_id, computed_pts, week, status')
      .eq('season', SEASON)
      .lte('week', LEAGUE.regularSeasonWeeks)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`player_stats: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      // `unique (player_id, season, week, status)` means a corrected week can hold both
      // a provisional and a final row. Summing both would double-count that week.
      if (row.status !== 'final') continue;
      const id = row.player_id as string;
      totals.set(id, (totals.get(id) ?? 0) + Number(row.computed_pts ?? 0));
    }
    if (data.length < 1000) break;
  }

  // Fall back to provisional where a player has no final rows at all, rather than
  // scoring them zero — a zero here reads as "drafted a bust", which would be a lie.
  if (totals.size === 0) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('player_stats')
        .select('player_id, computed_pts, week')
        .eq('season', SEASON)
        .lte('week', LEAGUE.regularSeasonWeeks)
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const id = row.player_id as string;
        totals.set(id, (totals.get(id) ?? 0) + Number(row.computed_pts ?? 0));
      }
      if (data.length < 1000) break;
    }
  }

  return totals;
}

async function main() {
  const supabase = db();

  const { data: season } = await supabase.from('seasons').select('id').eq('year', SEASON).single();
  if (!season) throw new Error(`no ${SEASON} season row`);

  const { data: picks, error } = await supabase
    .from('draft_picks')
    .select('pick_overall, round, team_id, player_id, teams!inner(models!inner(display_name))')
    .eq('season_id', season.id)
    .order('pick_overall', { ascending: true });
  if (error) throw new Error(`draft_picks: ${error.message}`);
  if (!picks || picks.length === 0) throw new Error(`no draft picks for ${SEASON}`);

  const nameOf = new Map<string, string>();
  for (const p of picks) {
    const team = p.teams as unknown as { models: { display_name: string } };
    nameOf.set(p.team_id as string, team.models.display_name);
  }

  const points = await seasonPoints(supabase);

  // The board the draft actually ran against, so "best available" means what those
  // models could really have taken (CLAUDE.md rule 6 — replay from our own snapshots).
  const pool: { playerId: string; position: Position; name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('player_projections')
      .select('player_id, proj_pts, players!inner(name, position)')
      .eq('season', SEASON)
      .is('week', null)
      .order('proj_pts', { ascending: false })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const player = row.players as unknown as { name: string; position: Position };
      pool.push({ playerId: row.player_id as string, position: player.position, name: player.name });
    }
    if (data.length < 1000 || pool.length >= 1000) break;
  }

  const board = pool.slice(0, 1000);
  const positionOf = new Map(board.map((p) => [p.playerId, p.position]));
  const nameOfPlayer = new Map(board.map((p) => [p.playerId, p.name]));

  const taken = new Set<string>();
  const perTeam = new Map<
    string,
    { drafted: number; captured: number; possible: number; best: number; roster: LineupPlayer[] }
  >();

  for (const pick of picks) {
    const teamId = pick.team_id as string;
    const playerId = pick.player_id as string;

    const entry =
      perTeam.get(teamId) ?? { drafted: 0, captured: 0, possible: 0, best: 0, roster: [] };

    const got = points.get(playerId) ?? 0;
    const available = board.filter((p) => !taken.has(p.playerId));
    const bestAvailable = available.reduce((max, p) => Math.max(max, points.get(p.playerId) ?? 0), 0);

    entry.drafted += got;
    entry.captured += got;
    entry.possible += bestAvailable;
    if (bestAvailable > 0 && got >= bestAvailable) entry.best += 1;
    entry.roster.push({
      playerId,
      position: positionOf.get(playerId) ?? 'WR',
      points: got,
    });

    perTeam.set(teamId, entry);
    taken.add(playerId);
  }

  const rows = [...perTeam.entries()].map(([teamId, e]) => {
    const starters = optimalLineup(e.roster);
    return {
      model: nameOf.get(teamId) ?? teamId,
      drafted: Math.round(e.drafted),
      starters: Math.round(starters.total),
      captureRate: e.possible > 0 ? e.captured / e.possible : 0,
      bestPicks: e.best,
      picks: e.roster.length,
    };
  });

  console.log(`\n  DRAFT EVAL — season ${SEASON}, ${picks.length} picks\n`);
  console.log('  Capture rate: points taken vs the best still on the board, at every pick.');
  console.log('  Graded against perfect hindsight from the slot each model actually picked at.\n');

  console.log(
    '  ' +
      'model'.padEnd(20) +
      'capture'.padStart(9) +
      'starters'.padStart(10) +
      'drafted'.padStart(9) +
      'best pick'.padStart(11),
  );
  for (const row of [...rows].sort((a, b) => b.captureRate - a.captureRate)) {
    console.log(
      '  ' +
        row.model.padEnd(20) +
        `${(row.captureRate * 100).toFixed(1)}%`.padStart(9) +
        String(row.starters).padStart(10) +
        String(row.drafted).padStart(9) +
        `${row.bestPicks}/${row.picks}`.padStart(11),
    );
  }

  const byStarters = [...rows].sort((a, b) => b.starters - a.starters);
  const byDrafted = [...rows].sort((a, b) => b.drafted - a.drafted);
  console.log(
    `\n  Best starting nine: ${byStarters[0].model} (${byStarters[0].starters})` +
      `\n  Most raw points:    ${byDrafted[0].model} (${byDrafted[0].drafted})\n`,
  );
}

main();
