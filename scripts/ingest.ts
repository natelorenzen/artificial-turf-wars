/**
 * Operator script for the Sleeper ingest.
 *
 *   npx tsx scripts/ingest.ts --dry-run          # hits Sleeper, writes nothing
 *   npm run ingest -- --players --schedule       # needs .env.local
 *   npm run ingest -- --stats --week 3 --status provisional
 */

import {
  dryRunSleeper,
  ingestPlayers,
  ingestProjections,
  ingestSchedule,
  ingestWeeklyStats,
} from '@/lib/sleeper/ingest';

function flag(name: string) {
  return process.argv.includes(`--${name}`);
}

function value(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const season = Number(value('season', process.env.SEASON_YEAR ?? '2026'));

  if (flag('dry-run')) {
    console.log(`Dry run against the live Sleeper feed, season ${season}\n`);
    console.dir(await dryRunSleeper(season), { depth: null });
    return;
  }

  const all = !flag('players') && !flag('schedule') && !flag('projections') && !flag('stats');

  if (all || flag('players')) console.log('players:', await ingestPlayers());
  if (all || flag('schedule')) console.log('schedule:', await ingestSchedule(season));
  if (all || flag('projections')) {
    const { projections, withAdp, skipped, calibration } = await ingestProjections(season);
    console.log("projections:", { projections, withAdp, skipped, sourceSeason: calibration.sourceSeason });
  }
  if (flag('stats')) {
    const week = Number(value('week'));
    const status = (value('status', 'provisional') as 'provisional' | 'final') ?? 'provisional';
    if (!week) throw new Error('--stats requires --week');
    console.log(`stats week ${week} (${status}):`, await ingestWeeklyStats(season, week, status));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
