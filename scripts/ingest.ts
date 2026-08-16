/**
 * Operator script for the Sleeper ingest.
 *
 *   npx tsx scripts/ingest.ts --dry-run          # hits Sleeper, writes nothing
 *   npm run ingest -- --players --schedule       # needs .env.local
 *   npm run ingest -- --stats --week 3 --status provisional
 *   npm run ingest -- --week-projections --week 5 --season 2025
 *   npm run ingest -- --preseason-stats --season 2026
 */

import {
  dryRunSleeper,
  ingestPlayers,
  ingestPreseasonStats,
  ingestProjections,
  ingestSchedule,
  ingestWeekProjections,
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

  // `--preseason-stats` is excluded from `all` on purpose: it is a preseason-only
  // concept, it is never scored, and folding it into the default run would put it in
  // the daily cron path where it would return nothing from September onward.
  const all =
    !flag('players') &&
    !flag('schedule') &&
    !flag('projections') &&
    !flag('week-projections') &&
    !flag('preseason-stats') &&
    !flag('stats');

  if (all || flag('players')) console.log('players:', await ingestPlayers());
  if (all || flag('schedule')) console.log('schedule:', await ingestSchedule(season));
  if (all || flag('projections')) {
    const { projections, withAdp, skipped, calibration } = await ingestProjections(season);
    console.log("projections:", { projections, withAdp, skipped, sourceSeason: calibration.sourceSeason });
  }
  // Per-week projections. The daily cron does this for the upcoming week of the live
  // season only, which leaves no way to populate a PAST week — and the 2025 rehearsal
  // needs exactly that before a weekly cycle can be run against it end to end.
  if (flag('week-projections')) {
    const week = Number(value('week'));
    if (!week) throw new Error('--week-projections requires --week');
    console.log(`week ${week} projections:`, await ingestWeekProjections(season, week));
  }
  if (flag('preseason-stats')) {
    console.log(`preseason stats:`, await ingestPreseasonStats(season));
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
