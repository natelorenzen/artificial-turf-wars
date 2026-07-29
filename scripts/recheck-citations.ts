/**
 * Re-run the citation post-pass over stored decisions.
 *
 *   npx tsx --env-file=.env.local scripts/recheck-citations.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/recheck-citations.ts
 *
 * The check is deterministic and its inputs are stored verbatim, so a fix to the
 * checker can be applied retroactively without re-calling a single model. That is
 * the payoff for storing `user_prompt` and `raw_response` rather than just the
 * verdict — a bad verdict is repairable, a lost prompt is not.
 *
 * Needed because two checker bugs published false findings: formatting notes filed
 * as fabrication, and rulebook citations flagged as invented.
 */

import { createClient } from '@supabase/supabase-js';
import { checkCitations } from '@/lib/prompt/cited';
import { rulebook } from '@/lib/prompt/rulebook';
import { reasoningSoftViolations } from '@/lib/schemas/decisions';

/** The DATA block is stored inside the prompt; recover the object it was built from. */
function extractDataBlock(userPrompt: string): unknown | null {
  const start = userPrompt.indexOf('=== DATA ===');
  const end = userPrompt.indexOf('=== END DATA ===');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(userPrompt.slice(start + '=== DATA ==='.length, end).trim());
  } catch {
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const rows: {
    id: string;
    user_prompt: string;
    key_factors: string[] | null;
    parsed_json: Record<string, unknown> | null;
    unsupported_claims: string[] | null;
  }[] = [];

  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from('decisions')
      .select('id, user_prompt, key_factors, parsed_json, unsupported_claims')
      .not('key_factors', 'is', null)
      .range(from, from + 499);
    if (error) throw new Error(`decisions: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < 500) break;
  }

  console.log(`${rows.length} decisions with reasoning to re-check.\n`);

  let changed = 0;
  let unparseable = 0;
  let claimsBefore = 0;
  let claimsAfter = 0;
  let softAfter = 0;

  for (const row of rows) {
    const keyFactors = row.key_factors ?? [];
    if (keyFactors.length === 0) continue;

    const data = extractDataBlock(row.user_prompt);
    if (data === null) {
      unparseable++;
      continue;
    }

    const citations = checkCitations(keyFactors, data, rulebook());
    const soft = row.parsed_json ? safeSoft(row.parsed_json) : [];

    claimsBefore += (row.unsupported_claims ?? []).length;
    claimsAfter += citations.unsupportedClaims.length;
    softAfter += soft.length;

    const differs =
      JSON.stringify(row.unsupported_claims ?? []) !== JSON.stringify(citations.unsupportedClaims);
    if (differs) changed++;

    if (!dryRun) {
      const { error } = await db
        .from('decisions')
        .update({
          cited_fields: citations.citedFields,
          unsupported_claims: citations.unsupportedClaims,
          soft_violations: soft,
        })
        .eq('id', row.id);
      if (error) throw new Error(`update ${row.id}: ${error.message}`);
    }
  }

  console.log(`  unsupported claims: ${claimsBefore} → ${claimsAfter}`);
  console.log(`  soft violations now recorded separately: ${softAfter}`);
  console.log(`  decisions whose verdict changed: ${changed}`);
  if (unparseable > 0) console.log(`  DATA block unrecoverable for ${unparseable} decisions`);
  console.log(dryRun ? '\n  dry run — nothing written' : '\n  written.');
}

function safeSoft(parsed: Record<string, unknown>): string[] {
  if (!Array.isArray(parsed.key_factors) || typeof parsed.headline !== 'string') return [];
  return reasoningSoftViolations(parsed as never);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
