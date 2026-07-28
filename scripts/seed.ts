/**
 * Seed the league: eight models, one season, eight teams, and the H2H schedule.
 *
 *   npx tsx --env-file=.env.local scripts/seed.ts
 *
 * Idempotent — safe to re-run. Nothing here is irreversible: no auction, no draft,
 * no model calls, no money.
 *
 * Two things are deliberately NOT done here:
 *   - `draft_seed` stays null. Only sha256(seed) is stored now, as a public
 *     commitment. The raw seed is revealed after the auction so anyone can verify
 *     the tiebreaks were not chosen after seeing the bids (SPEC §8.3).
 *   - Teams get no `draft_slot`. That is won at auction, not assigned (SPEC §4.2).
 *
 * The H2H schedule IS generated here, before the auction, because generating it
 * afterwards would let results shape who plays whom when (SPEC §6.1).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE, RULEBOOK_VERSION } from '@/lib/config/league';
import { rulebook } from '@/lib/prompt/rulebook';
import { commitHash } from '@/lib/engine/rng';
import { generateH2HSchedule } from '@/lib/engine/schedule';

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function main() {
  const seed = process.env.DRAFT_SEED;
  if (!seed) throw new Error('DRAFT_SEED is not set. Generate one with: openssl rand -hex 32');
  if (seed.length < 32) throw new Error('DRAFT_SEED is too short to be worth committing to');

  const season = Number(process.env.SEASON_YEAR ?? '2026');
  const supabase = db();
  const seedHash = commitHash(seed);

  // --- models -------------------------------------------------------------
  const { error: modelError } = await supabase.from('models').upsert(
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
  if (modelError) throw new Error(`models: ${modelError.message}`);

  const { data: models, error: readModels } = await supabase.from('models').select('id, key, display_name');
  if (readModels) throw new Error(`models read: ${readModels.message}`);

  // --- season -------------------------------------------------------------
  const { error: seasonError } = await supabase.from('seasons').upsert(
    {
      year: season,
      scoring_config: LEAGUE.scoring as unknown as Record<string, unknown>,
      rulebook_version: RULEBOOK_VERSION,
      rulebook_text: rulebook(),
      budget_total: LEAGUE.budgetTotal,
      seed_commit_hash: seedHash,
      // draft_seed stays null until the post-auction reveal.
    },
    { onConflict: 'year' },
  );
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);

  const { data: seasonRow, error: readSeason } = await supabase
    .from('seasons')
    .select('id, seed_commit_hash')
    .eq('year', season)
    .single();
  if (readSeason) throw new Error(`season read: ${readSeason.message}`);

  if (seasonRow.seed_commit_hash !== seedHash) {
    throw new Error(
      `The season already committed to ${seasonRow.seed_commit_hash} but DRAFT_SEED now hashes to ${seedHash}. ` +
        'Changing the seed after publishing its hash destroys the commitment. Refusing.',
    );
  }

  // --- teams --------------------------------------------------------------
  const { error: teamError } = await supabase.from('teams').upsert(
    models!.map((m) => ({
      season_id: seasonRow.id,
      model_id: m.id,
      faab_remaining: LEAGUE.budgetTotal,
    })),
    { onConflict: 'season_id,model_id' },
  );
  if (teamError) throw new Error(`teams: ${teamError.message}`);

  const { data: teams, error: readTeams } = await supabase
    .from('teams')
    .select('id, model_id')
    .eq('season_id', seasonRow.id);
  if (readTeams) throw new Error(`teams read: ${readTeams.message}`);

  // --- H2H schedule -------------------------------------------------------
  const { count: existing } = await supabase
    .from('h2h_schedule')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonRow.id);

  let scheduleNote = `${existing} matchups already committed — left untouched`;
  if (!existing) {
    const matchups = generateH2HSchedule(
      teams!.map((t) => t.id as string),
      seed,
    );
    const { error: scheduleError } = await supabase.from('h2h_schedule').insert(
      matchups.map((m) => ({
        season_id: seasonRow.id,
        week: m.week,
        home_team_id: m.homeTeamId,
        away_team_id: m.awayTeamId,
      })),
    );
    if (scheduleError) throw new Error(`h2h_schedule: ${scheduleError.message}`);
    scheduleNote = `${matchups.length} matchups over ${LEAGUE.regularSeasonWeeks} weeks (balanced double round-robin, asserted)`;
  }

  const byId = new Map(models!.map((m) => [m.id, m.display_name]));
  console.log(`Season ${season} seeded.\n`);
  console.log(`  models    ${models!.length}`);
  console.log(`  teams     ${teams!.length}  ${teams!.map((t) => byId.get(t.model_id)).join(', ')}`);
  console.log(`  schedule  ${scheduleNote}`);
  console.log(`  budget    $${LEAGUE.budgetTotal} per team, shared between the auction and FAAB`);
  console.log(`  rulebook  ${RULEBOOK_VERSION}, frozen into the season row\n`);
  console.log('  SEED COMMITMENT — publish this before the auction:');
  console.log(`    sha256(seed) = ${seedHash}\n`);
  console.log('  Draft slots are unassigned. They are won at auction (SPEC §4.2).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
