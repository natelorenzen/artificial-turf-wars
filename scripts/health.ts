/**
 * Did the jobs that should have run, run?
 *
 *   npx tsx --env-file=.env.local scripts/health.ts
 *   npx tsx --env-file=.env.local scripts/health.ts --at 2026-09-15T18:00:00Z   # ask as of a moment
 *   npx tsx --env-file=.env.local scripts/health.ts --json
 *
 * Read-only. The `--at` form is how you check a Tuesday before Tuesday: it replays the
 * same resolvers against a different `now` and tells you what the watchdog WOULD say.
 *
 * Exit code is 1 when anything is late or stuck, so this works in a pipeline as well
 * as on a terminal.
 */

import { createClient } from '@supabase/supabase-js';
import { seasonIdFor } from '@/lib/scoring/week';
import { checkHealth, type HealthState } from '@/lib/cron/health';

const MARK: Record<HealthState, string> = {
  ok: '  ok  ',
  late: ' LATE ',
  stuck: 'STUCK ',
  idle: ' idle ',
  unverifiable: '  ?   ',
};

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

async function main() {
  const atArg = process.argv.indexOf('--at');
  const now = atArg > -1 ? new Date(process.argv[atArg + 1]) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--at needs an ISO timestamp');

  const season = Number(process.env.SEASON_YEAR ?? '2026');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const seasonId = await seasonIdFor(db, season);
  const report = await checkHealth(db, seasonId, season, now);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.healthy ? 0 : 1);
  }

  console.log(`\n  CRON HEALTH · season ${season} · as of ${report.checkedAt}\n`);

  for (const job of report.jobs) {
    const name = job.job.replace('/api/cron/', '').padEnd(18);
    console.log(`  [${MARK[job.state]}] ${name} ${wrap(job.detail, 76, ' '.repeat(29))}`);
  }

  const bad = report.jobs.filter((j) => j.state === 'late' || j.state === 'stuck');
  if (bad.length === 0) {
    console.log('\n  Healthy. Every job that was due has left the evidence it was supposed to.\n');
  } else {
    console.log(`\n  ${bad.length} PROBLEM(S): ${bad.map((j) => j.job).join(', ')}\n`);
  }

  process.exit(report.healthy ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
