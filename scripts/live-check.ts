/**
 * What the live scorer would show right now.
 *
 *   npx tsx --env-file=.env.local scripts/live-check.ts            # dry run, writes nothing
 *   npx tsx --env-file=.env.local scripts/live-check.ts --write    # store it, as the cron does
 *
 * The cron route is the thing that runs in production, but it needs a deployment and a
 * secret to poke, and its output is JSON. This prints the table a reader would see, so
 * "are these numbers right" is a question you can answer by looking at it beside the
 * NFL scores on television.
 *
 * The dry run is genuinely read-only. It fetches Sleeper and scores the locked lineups
 * in memory, exactly as the job does, and stops before the write.
 */

import { createClient } from '@supabase/supabase-js';
import { seasonIdFor } from '@/lib/scoring/week';
import { liveWeekIsComplete, resolveLiveWeek, scoreLiveWeek } from '@/lib/scoring/live';
import { FANTASY_POSITIONS, fetchWeeklyStats } from '@/lib/sleeper/client';
import { scorePlayerWeek } from '@/lib/scoring/engine';
import { scoreLineup, type Lineup } from '@/lib/engine/lineup';

async function main() {
  const write = process.argv.includes('--write');
  const season = Number(process.env.SEASON_YEAR ?? '2026');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const seasonId = await seasonIdFor(db, season);
  const week = await resolveLiveWeek(db, seasonId, season);

  if (week === null) {
    console.log(
      '\n  Nothing to show. No week is both in progress and unscored —\n' +
        '  either the slate has not kicked off, or Tuesday has already made it official.\n',
    );
    return;
  }

  const complete = await liveWeekIsComplete(db, season, week);
  console.log(`\n  WEEK ${week} · ${complete ? 'all games in' : 'under way'} · season ${season}`);

  if (write) {
    const result = await scoreLiveWeek(db, { seasonId, season, week });
    console.log(`  stored ${result.teams.length} rows at ${result.computedAt}`);
    console.log(`  ${result.statLines} stat lines, ${result.skippedDefenses} defenses skipped\n`);
  }

  // Re-derive for display rather than reusing the write path's return, so a dry run and
  // a stored run print from the same code and a `--write` can be compared against what
  // actually landed in the table.
  const points = new Map<string, number>();
  for (const position of FANTASY_POSITIONS) {
    const result = await fetchWeeklyStats(season, week, position);
    for (const rec of result.data) {
      const stats = rec.stats ?? {};
      if (position === 'DEF' && !('pts_allow' in stats)) continue;
      if (Object.keys(stats).length === 0) continue;
      points.set(rec.player_id, scorePlayerWeek(position, stats).points);
    }
  }

  const { data: teams } = await db
    .from('teams')
    .select('id, models!inner(display_name)')
    .eq('season_id', seasonId);
  const nameOf = new Map(
    ((teams ?? []) as unknown as { id: string; models: { display_name: string } }[]).map((t) => [
      t.id,
      t.models.display_name,
    ]),
  );

  const { data: lineups } = await db
    .from('lineups')
    .select('team_id, qb, rb, wr, te, flex, k, def')
    .eq('week', week)
    .in('team_id', [...nameOf.keys()]);

  const rows = (lineups ?? []).map((row) => {
    const lineup: Lineup = {
      qb: row.qb as string | null,
      rb: (row.rb ?? []) as string[],
      wr: (row.wr ?? []) as string[],
      te: row.te as string | null,
      flex: row.flex as string | null,
      k: row.k as string | null,
      def: row.def as string | null,
    };
    const scored = scoreLineup(lineup, points);
    const filled = scored.perSlot.filter((s) => !s.empty);
    const played = filled.filter((s) => s.playerId && points.has(s.playerId)).length;
    return {
      model: nameOf.get(row.team_id as string) ?? 'Unknown',
      total: scored.total,
      played,
      of: scored.perSlot.length,
    };
  });

  rows.sort((a, b) => b.total - a.total);
  console.log('');
  for (const row of rows) {
    console.log(
      `    ${row.model.padEnd(24)} ${row.total.toFixed(1).padStart(7)}   ` +
        `${row.played}/${row.of} starters played`,
    );
  }

  console.log(
    `\n  ${write ? 'Stored.' : 'Dry run — nothing written.'} These numbers are never ` +
      `authoritative:\n  week ${week} is scored for real on Tuesday.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
