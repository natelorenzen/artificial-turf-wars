/**
 * The NFL picks DATA block for a week, built against real rows.
 *
 *   npx tsx --env-file=.env.local scripts/picks.ts --week 3            # print, no calls
 *   npx tsx --env-file=.env.local scripts/picks.ts --week 3 --odds     # + snapshot odds
 *   npx tsx --env-file=.env.local scripts/picks.ts --week 3 --run      # call all eight
 *
 * Prints what every model would be sent: the games still open, each team's season so
 * far, the injury report, the projected quarterbacks, the moneylines, the context hash,
 * and every model's bankroll.
 *
 * `--run` is the manual path for a week the cron job cannot reach — week 3 of 2026,
 * whose Thursday game had been played before picks shipped. It skips the cron's
 * before-first-kickoff guard and relies instead on the per-game one: only games whose
 * start time is still ahead are offered, so no pick is ever made on a game in progress.
 * Uses the same `job_runs` claim as the cron, so it cannot double-spend a week.
 */

import { createClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { estimateTokens } from '@/lib/prompt/assemble';
import { formatPrice } from '@/lib/picks/odds';
import { STARTING_BANKROLL } from '@/lib/picks/bankroll';
import {
  buildPicksData,
  loadBankrolls,
  loadOddsSnapshot,
  picksUserPrompt,
  PICKS_SYSTEM,
  runPicks,
  storeOddsSnapshot,
} from '@/lib/picks/run';
import { seasonIdFor } from '@/lib/scoring/week';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

async function main() {
  const weekArg = process.argv.indexOf('--week');
  const week = Number(process.argv[weekArg + 1]);
  if (weekArg < 0 || !Number.isInteger(week)) throw new Error('usage: --week N [--odds] [--run]');
  const wantOdds = process.argv.includes('--odds');
  const run = process.argv.includes('--run');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const seasonId = await seasonIdFor(db, SEASON);
  const apiKey = process.env.ODDS_API_KEY;

  if (wantOdds && !run) {
    if (!apiKey) throw new Error('ODDS_API_KEY is not set in .env.local');
    const snap = await storeOddsSnapshot(db, seasonId, SEASON, week, apiKey);
    console.log(`\n  stored odds snapshot ${snap.id}: ${snap.lines.size} lines, ${snap.remaining ?? '?'} feed requests left`);
  }

  if (run) {
    if (!(await loadOddsSnapshot(db, seasonId, week)) && !apiKey) {
      throw new Error('no odds snapshot for this week and no ODDS_API_KEY — the models could not bet. Refusing.');
    }
    const result = await runPicks(db, { season: SEASON, seasonId, week, oddsApiKey: apiKey });
    if (result.skipped) {
      console.log(`\n  skipped: ${result.skipped}\n`);
      return;
    }
    console.log(`\n  WEEK ${week} PICKS — ${result.games} games, ${result.gamesWithOdds} with odds · ${result.oddsNote}`);
    console.log(`  context hash ${result.contextHash}\n`);
    for (const o of result.sets) {
      console.log(
        `  ${o.entrant.displayName.padEnd(22)} ${o.valid ? 'valid  ' : o.providerFailure ? 'OUTAGE ' : 'INVALID'}` +
          ` staked $${String(o.staked).padStart(3)} of $${o.available.toFixed(2)}` +
          (o.error ? `  — ${o.error}` : ''),
      );
    }
    for (const e of result.errors) console.log(`  ERROR ${e}`);
    console.log(`\n  cost $${result.costUsd.toFixed(4)}\n`);
    return;
  }

  const input = await buildPicksData(db, SEASON, week, { seasonId });
  const data = input.data as {
    games: { game_key: string; date: string | null; moneyline: Record<string, number> | null }[];
    this_season: Record<string, { record: string }>;
    injuries: Record<string, { name: string; position: string; status: string }[]>;
    projected_starting_qb: Record<string, string | null>;
  };

  console.log(`\n  NFL PICKS — ${SEASON} week ${week}, ${input.fixtures.length} games open, ${input.lines.size} with odds`);
  console.log(`  context hash ${input.contextHash}\n`);
  for (const f of input.fixtures) {
    const game = data.games.find((g) => g.game_key === f.gameKey);
    const side = (t: string) => {
      const hurt = data.injuries[t] ?? [];
      const price = game?.moneyline?.[t];
      return `${t} ${price === undefined ? '' : formatPrice(price) + ' '}${data.this_season[t]?.record ?? '?'} QB ${data.projected_starting_qb[t] ?? '—'}` +
        (hurt.length ? ` [${hurt.map((h) => `${h.name} ${h.status}`).join(', ')}]` : '');
    };
    console.log(`  ${f.gameKey.padEnd(9)} ${game?.date ?? '?'}  ${side(f.away)}  @  ${side(f.home)}`);
  }

  const bankrolls = await loadBankrolls(db, seasonId, SEASON);
  const { data: models } = await db.from('models').select('id, key');
  console.log('\n  bankrolls');
  for (const m of COHORT) {
    const id = models?.find((x) => x.key === m.key)?.id as string | undefined;
    const b = id ? bankrolls.get(id) : undefined;
    console.log(`    ${m.displayName.padEnd(22)} $${(b?.available ?? STARTING_BANKROLL).toFixed(2)} available` + (b?.atRisk ? `, $${b.atRisk} at risk` : ''));
  }

  const prompt = PICKS_SYSTEM + picksUserPrompt(input, STARTING_BANKROLL);
  console.log(`\n  prompt ≈ ${estimateTokens(prompt).toLocaleString()} tokens\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
