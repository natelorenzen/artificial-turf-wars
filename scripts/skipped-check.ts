/**
 * Which projected players did the FK filter drop, and does any of them matter?
 *
 *   npx tsx --env-file=.env.local scripts/skipped-check.ts
 *
 * Sleeper's projections host returns ids its own player pool does not contain. Those
 * rows are dropped at ingest. This checks the drop is harmless — if a genuinely
 * draftable player is missing from the board, every model drafts from an incomplete
 * pool and the season is compromised before it starts.
 */

import { createClient } from '@supabase/supabase-js';
import { FANTASY_POSITIONS, fetchSeasonProjections } from '@/lib/sleeper/client';
import { fetchCalibration } from '@/lib/sleeper/ingest';
import { projectSeasonPoints } from '@/lib/sleeper/normalize';

async function main() {
  const season = Number(process.env.SEASON_YEAR ?? '2026');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('players').select('sleeper_id').range(from, from + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => known.add(r.sleeper_id as string));
    if (data.length < 1000) break;
  }

  const calibration = await fetchCalibration(season - 1);
  const dropped: { name: string; position: string; points: number }[] = [];

  for (const position of FANTASY_POSITIONS) {
    const result = await fetchSeasonProjections(season, position);
    for (const rec of result.data) {
      if (known.has(rec.player_id)) continue;
      dropped.push({
        name: [rec.player?.first_name, rec.player?.last_name].filter(Boolean).join(' ') || rec.player_id,
        position,
        points: projectSeasonPoints(position, rec, calibration).points,
      });
    }
  }

  dropped.sort((a, b) => b.points - a.points);

  // A 15-round, 8-team draft consumes 120 players. Anyone projecting above the
  // weakest of those is genuinely draftable and must not be silently absent.
  const { data: board } = await db
    .from('player_projections')
    .select('proj_pts')
    .eq('season', season)
    .order('proj_pts', { ascending: false })
    .limit(120);
  const draftableFloor = Number(board?.[board.length - 1]?.proj_pts ?? 0);

  console.log(`${dropped.length} projected players are absent from the player pool.`);
  console.log(`Draftable floor (120th best projection): ${draftableFloor.toFixed(1)}\n`);
  console.log('Highest-projected drops:');
  for (const player of dropped.slice(0, 10)) {
    const flag = player.points >= draftableFloor ? '  *** DRAFTABLE ***' : '';
    console.log(`  ${player.points.toFixed(1).padStart(7)}  ${player.position.padEnd(4)} ${player.name}${flag}`);
  }

  const concerning = dropped.filter((p) => p.points >= draftableFloor);
  console.log(
    concerning.length === 0
      ? '\nNone of the dropped players would have been drafted. Safe to ignore.'
      : `\n*** ${concerning.length} dropped player(s) are inside draftable range. Fix before the draft. ***`,
  );
  if (concerning.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
