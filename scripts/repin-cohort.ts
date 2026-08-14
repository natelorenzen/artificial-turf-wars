/**
 * Move the league onto a revised cohort, before the freeze date.
 *
 *   npx tsx --env-file=.env.local scripts/repin-cohort.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/repin-cohort.ts --commit
 *
 * ---------------------------------------------------------------------------
 * Why this is not just `seed.ts`
 * ---------------------------------------------------------------------------
 * `seed.ts` upserts `models` on `key`. A re-pin CHANGES the key — `grok-4-5` becomes
 * `grok-4-6` — so the upsert inserts a brand new row, leaves the old one in place, and
 * every `teams.model_id` goes on pointing at the model that was replaced. The seed
 * reports success, the site shows the new cohort in its table, and the league quietly
 * plays the season with the old models. That failure is silent in every direction, and
 * it is the entire reason this file exists.
 *
 * The SEAT is the lab. Each of the eight seats belongs to a lab for the whole season,
 * and a re-pin moves that seat from one of the lab's models to another. Matching on lab
 * is what makes the move unambiguous.
 *
 * ---------------------------------------------------------------------------
 * When this may run
 * ---------------------------------------------------------------------------
 * Before the draft, and before COHORT_FROZEN_AT. After either, the answer is no:
 *
 *   - after the draft, 120 picks were made by specific models under a specific
 *     rulebook, and re-pointing a team would attribute one model's roster to another;
 *   - after the freeze date, the published rule is that no ID changes for any reason
 *     short of a provider withdrawal. A freeze that bends is not a freeze, and it is
 *     the first thing a sceptical reader pulls at.
 *
 * Superseded models are deactivated rather than deleted. They hold the comprehension
 * checks and preseason decisions they actually made, and erasing that would rewrite the
 * record of what was tried.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, COHORT_FROZEN_AT, LEAGUE } from '@/lib/config/league';

const SEASON = LEAGUE.season;

const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`\n  REFUSING TO RUN\n  ${message}\n`);
  process.exit(1);
}

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface ModelRow {
  id: string;
  key: string;
  display_name: string;
  openrouter_id: string;
  lab: string;
  active: boolean;
}

async function main() {
  const commit = flag('commit');
  const supabase = db();

  const today = new Date().toISOString().slice(0, 10);
  if (today > COHORT_FROZEN_AT) {
    fail(
      `the cohort froze on ${COHORT_FROZEN_AT} and today is ${today}.\n` +
        '  After the freeze date no model ID changes, for any reason short of a provider\n' +
        '  withdrawing one. That rule is published on /methodology.',
    );
  }

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', SEASON)
    .single();
  if (seasonError) fail(`no ${SEASON} season row: ${seasonError.message}`);

  const { count: picks } = await supabase
    .from('draft_picks')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', season.id);
  if ((picks ?? 0) > 0) {
    fail(
      `the ${SEASON} draft has already run — ${picks} picks exist.\n` +
        '  Those picks were made by specific models. Re-pointing a team now would\n' +
        "  attribute one model's roster to another.",
    );
  }

  const { data: modelRows, error: modelError } = await supabase
    .from('models')
    .select('id, key, display_name, openrouter_id, lab, active');
  if (modelError) fail(`models: ${modelError.message}`);
  const models = (modelRows ?? []) as ModelRow[];

  const { data: teamRows, error: teamError } = await supabase
    .from('teams')
    .select('id, model_id')
    .eq('season_id', season.id);
  if (teamError) fail(`teams: ${teamError.message}`);
  const teams = (teamRows ?? []) as { id: string; model_id: string }[];

  const modelById = new Map(models.map((m) => [m.id, m]));

  // --- what changes ---------------------------------------------------------
  console.log(`\n  RE-PIN COHORT — season ${SEASON}${commit ? '' : '  (dry run)'}\n`);

  const moves: { lab: string; from: ModelRow | null; toKey: string; toId: string; teamId: string | null }[] = [];

  for (const target of COHORT) {
    const seat = teams.find((t) => modelById.get(t.model_id)?.lab === target.lab) ?? null;
    const current = seat ? (modelById.get(seat.model_id) ?? null) : null;

    if (current && current.openrouter_id === target.openrouterId) {
      console.log(`  =  ${target.lab.padEnd(10)} ${target.displayName} — unchanged`);
      continue;
    }
    console.log(
      `  →  ${target.lab.padEnd(10)} ${current ? current.openrouter_id : '(no seat)'} → ${target.openrouterId}`,
    );
    moves.push({
      lab: target.lab,
      from: current,
      toKey: target.key,
      toId: '',
      teamId: seat?.id ?? null,
    });
  }

  if (moves.length === 0) {
    console.log('\n  Nothing to do — every seat already holds its target model.\n');
    return;
  }

  // Every seat must be identifiable, or a "move" would silently create a ninth model
  // and leave a team behind on the old one.
  const orphaned = moves.filter((m) => m.teamId === null);
  if (orphaned.length > 0) {
    fail(
      `no ${SEASON} team could be matched to ${orphaned.map((m) => m.lab).join(', ')}.\n` +
        '  A seat belongs to a lab for the season. Fix the seat before re-pinning it.',
    );
  }

  if (!commit) {
    console.log(`\n  ${moves.length} seat(s) would move. Re-run with --commit to write.\n`);
    return;
  }

  // --- write ----------------------------------------------------------------
  const { error: upsertError } = await supabase.from('models').upsert(
    COHORT.map((m) => ({
      key: m.key,
      display_name: m.displayName,
      openrouter_id: m.openrouterId,
      lab: m.lab,
      context_window: m.contextWindow,
      price_in: m.priceIn,
      price_out: m.priceOut,
      active: true,
    })),
    { onConflict: 'key' },
  );
  if (upsertError) fail(`models upsert: ${upsertError.message}`);

  const { data: refreshed } = await supabase.from('models').select('id, key');
  const idOfKey = new Map((refreshed ?? []).map((m) => [m.key as string, m.id as string]));

  for (const move of moves) {
    const newId = idOfKey.get(move.toKey);
    if (!newId) fail(`model ${move.toKey} is missing after the upsert`);

    const { error } = await supabase.from('teams').update({ model_id: newId }).eq('id', move.teamId!);
    if (error) fail(`teams update (${move.lab}): ${error.message}`);

    if (move.from) {
      // Deactivated, never deleted. It holds the comprehension check and any preseason
      // decisions it actually made, and erasing those rewrites what was tried.
      const { error: deactivate } = await supabase
        .from('models')
        .update({ active: false })
        .eq('id', move.from.id);
      if (deactivate) fail(`models deactivate (${move.from.key}): ${deactivate.message}`);
    }
    console.log(`  ✓ ${move.lab} now plays ${move.toKey}`);
  }

  console.log(
    `\n  ${moves.length} seat(s) moved.\n\n` +
      '  STILL REQUIRED before the draft:\n' +
      '    - re-sit the comprehension check, so every model in the league has passed\n' +
      '      the current rulebook: scripts/preseason-rules-check.ts\n' +
      '    - update the cohort table on /methodology with what moved and why\n',
  );
}

main();
