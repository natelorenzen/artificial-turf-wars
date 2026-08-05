/**
 * The Thursday weekend guide — "how to survive this weekend".
 *
 *   npx tsx --env-file=.env.local scripts/weekend-guide.ts --week 1 --ingest
 *   npx tsx --env-file=.env.local scripts/weekend-guide.ts --week 1           # dry run
 *   npx tsx --env-file=.env.local scripts/weekend-guide.ts --week 1 --commit
 *
 * Eight competing models each give one bounded take on the week's four most
 * interesting games, grounded in a shared DATA block. The non-competing beat writer
 * then assembles those thirty-two takes into one article.
 *
 * A dry run does everything except call a model: it selects the games, builds and
 * hashes each DATA block, asserts no lab name leaks into it, and prints what a run
 * would cost. That is most of what can go wrong.
 */

import { writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { ingestWeekProjections } from '@/lib/sleeper/ingest';
import {
  buildWeekContexts,
  gameDataBlock,
  interestScore,
  selectionDiscriminates,
} from '@/lib/preview/games';
import {
  GAMES_PER_GUIDE,
  takesForGame,
  toWriterInput,
  writeGuide,
  guideToMarkdown,
  type CohortEntry,
  type TakeResult,
} from '@/lib/preview/guide';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function argValue(name: string): string | null {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function seasonId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from('seasons').select('id').eq('year', SEASON).maybeSingle();
  return (data?.id as string) ?? null;
}

async function main() {
  const weekArg = argValue('week');
  const week = Number(weekArg);
  if (!Number.isInteger(week) || week < 1 || week > LEAGUE.regularSeasonWeeks) {
    console.error(`--week must be 1..${LEAGUE.regularSeasonWeeks}, got "${weekArg}"`);
    process.exit(1);
  }

  const supabase = db();
  const commit = flag('commit');
  const count = Number(argValue('games') ?? GAMES_PER_GUIDE);

  if (flag('ingest')) {
    console.log(`\n  Ingesting ${SEASON} week ${week} projections...`);
    const result = await ingestWeekProjections(SEASON, week, { db: supabase });
    console.log(`  ${result.projections} rows, ${result.withOpponent} with an opponent.\n`);
    if (!flag('run')) return;
  }

  const sid = await seasonId(supabase);
  const contexts = await buildWeekContexts(supabase, SEASON, week, sid);

  if (contexts.length === 0) {
    console.error(
      `\n  No games with projections for ${SEASON} week ${week}.\n` +
        `  Run with --ingest first.\n`,
    );
    process.exit(1);
  }

  const chosen = contexts.slice(0, count);

  console.log(`\n  WEEKEND GUIDE — ${SEASON} week ${week}\n`);
  console.log(`    fixtures with data   ${contexts.length}`);
  console.log(`    covering             ${chosen.length}`);
  console.log(`    model calls          ${chosen.length * COHORT.length} takes + 1 writer`);
  console.log(`    mode                 ${commit ? '*** COMMIT — spends money and writes ***' : 'DRY RUN — no calls, no writes'}\n`);

  console.log('    rank  game        interest   star   stake  imbal');
  contexts.slice(0, Math.max(count, 6)).forEach((c, i) => {
    const mark = i < count ? '*' : ' ';
    console.log(
      `    ${mark}${String(i + 1).padStart(3)}  ${c.fixture.gameKey.padEnd(10)} ` +
        `${interestScore(c).toFixed(1).padStart(8)}  ${c.starPower.toFixed(1).padStart(6)}  ` +
        `${String(c.leagueStake).padStart(5)}  ${c.imbalance.toFixed(1).padStart(5)}`,
    );
  });

  const gate = selectionDiscriminates(contexts, count);
  console.log(`\n    selection: ${gate.ok ? 'OK' : '*** ARBITRARY ***'} — ${gate.reason}`);

  if (!commit) {
    console.log('\n    DATA blocks:');
    for (const context of chosen) {
      const serialized = JSON.stringify(gameDataBlock(context, week));
      console.log(
        `      ${context.fixture.gameKey.padEnd(10)} ${String(serialized.length).padStart(6)} chars  ` +
          `~${Math.ceil(serialized.length / 3.5)} tokens`,
      );
    }
    // Same assertion the live path makes, so a leak is caught here rather than in
    // front of eight models.
    for (const context of chosen) {
      const serialized = JSON.stringify(gameDataBlock(context, week));
      const { assertNoLabelLeak } = await import('@/lib/engine/labels');
      assertNoLabelLeak(serialized, FORBIDDEN_NAMES);
    }
    console.log(`      label leak  none (checked against ${FORBIDDEN_NAMES.length} names)`);
    console.log('\n    Re-run with --commit to generate.\n');
    return;
  }

  // --- live ---------------------------------------------------------------
  const { data: modelRows } = await supabase.from('models').select('id, key');
  const idOf = new Map((modelRows ?? []).map((m) => [m.key as string, m.id as string]));
  const cohort: CohortEntry[] = COHORT.map((m) => ({
    key: m.key,
    displayName: m.displayName,
    openrouterId: m.openrouterId,
    modelId: idOf.get(m.key) ?? null,
  }));

  const all: TakeResult[] = [];
  let cost = 0;

  for (const context of chosen) {
    console.log(`\n  ${context.fixture.gameKey}`);
    const takes = await takesForGame(context, week, cohort, FORBIDDEN_NAMES);
    for (const t of takes) {
      cost += t.costUsd;
      console.log(
        t.take
          ? `    ${t.displayName.padEnd(16)} conf ${t.take.confidence.toFixed(2)}  ${t.take.novice_point.slice(0, 70)}`
          : `    ${t.displayName.padEnd(16)} FAILED`,
      );
    }
    all.push(...takes);
  }

  if (sid) await persistTakes(supabase, sid, week, all);

  console.log('\n  Assembling the article...');
  const written = await writeGuide(toWriterInput(week, chosen, all));
  cost += written.costUsd;

  if (!written.guide) {
    console.error(`  Writer failed. Raw:\n${written.raw?.slice(0, 500)}`);
    process.exit(1);
  }

  const outPath = `weekend-guide-${SEASON}-week-${week}.md`;
  writeFileSync(
    outPath,
    `# ${written.guide.headline}\n\n*${written.guide.standfirst}*\n\n${guideToMarkdown(written.guide)}\n`,
    'utf8',
  );

  let stored = false;
  if (sid) {
    const { error } = await supabase.from('weekend_guides').upsert(
      {
        season_id: sid,
        week,
        headline: written.guide.headline,
        standfirst: written.guide.standfirst,
        column_md: guideToMarkdown(written.guide),
        sections: written.guide.games,
        game_keys: chosen.map((c) => c.fixture.gameKey),
        facts_packet: written.factsPacket as unknown as Record<string, unknown>,
        facts_packet_hash: written.factsPacketHash,
        model_calls: all.length + 1,
        cost_usd: cost,
        // A cron job writes the draft. A human releases it.
        published: false,
      },
      { onConflict: 'season_id,week' },
    );
    if (error) console.error(`  weekend_guides: ${error.message}`);
    else stored = true;
  }

  const ok = all.filter((t) => t.take).length;
  console.log(`\n  ${ok}/${all.length} takes, article written.`);
  console.log(`  "${written.guide.headline}"`);
  console.log(`  Cost: $${cost.toFixed(4)}`);
  console.log(`  Written to ${outPath}.`);
  console.log(
    stored
      ? '  Stored in weekend_guides, unpublished — a human releases it.\n'
      : '  NOT stored in the database. Apply migration 0004 to persist it.\n',
  );
}

async function persistTakes(
  supabase: SupabaseClient,
  sid: string,
  week: number,
  takes: TakeResult[],
) {
  const rows = takes.map((t) => ({
    season_id: sid,
    week,
    game_key: t.gameKey,
    model_id: t.modelId,
    novice_point: t.take?.novice_point ?? null,
    expert_point: t.take?.expert_point ?? null,
    player_to_watch: t.take?.player_to_watch ?? null,
    swing_factor: t.take?.swing_factor ?? null,
    confidence: t.take?.confidence ?? null,
    cited_fields: t.citedFields,
    unsupported_claims: t.unsupportedClaims,
    raw_response: t.raw,
    valid: t.valid,
    context_hash: t.contextHash,
    cost_usd: t.costUsd,
  }));
  const { error } = await supabase
    .from('game_takes')
    .upsert(rows, { onConflict: 'season_id,week,game_key,model_id' });
  if (error) console.error(`  game_takes: ${error.message}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
