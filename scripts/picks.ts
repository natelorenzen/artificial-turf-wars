/**
 * The NFL picks DATA block for a week, built against real rows, with no model called
 * and nothing written.
 *
 *   npx tsx --env-file=.env.local scripts/picks.ts --week 3
 *
 * Prints what every model would be sent: the games, each team's season so far, the
 * injury report and the projected quarterbacks, the context hash, and the prompt's size.
 */

import { createClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { estimateTokens } from '@/lib/prompt/assemble';
import { buildPicksData, picksUserPrompt, PICKS_SYSTEM } from '@/lib/picks/run';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

async function main() {
  const weekArg = process.argv.indexOf('--week');
  const week = Number(process.argv[weekArg + 1]);
  if (weekArg < 0 || !Number.isInteger(week)) throw new Error('usage: --week N');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const input = await buildPicksData(db, SEASON, week);
  const data = input.data as {
    games: { game_key: string; date: string | null }[];
    this_season: Record<string, { record: string }>;
    injuries: Record<string, { name: string; position: string; status: string }[]>;
    projected_starting_qb: Record<string, string | null>;
  };

  console.log(`\n  NFL PICKS — ${SEASON} week ${week}, ${input.fixtures.length} games`);
  console.log(`  context hash ${input.contextHash}\n`);
  for (const f of input.fixtures) {
    const side = (t: string) => {
      const hurt = data.injuries[t] ?? [];
      return `${t} ${data.this_season[t]?.record ?? '?'} QB ${data.projected_starting_qb[t] ?? '—'}` +
        (hurt.length ? ` [${hurt.map((h) => `${h.name} ${h.status}`).join(', ')}]` : '');
    };
    console.log(`  ${f.gameKey.padEnd(9)} ${(data.games.find((g) => g.game_key === f.gameKey)?.date ?? '?')}  ${side(f.away)}  @  ${side(f.home)}`);
  }
  const prompt = PICKS_SYSTEM + picksUserPrompt(input);
  console.log(`\n  prompt ≈ ${estimateTokens(prompt).toLocaleString()} tokens\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
