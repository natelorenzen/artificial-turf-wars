/**
 * Live facts for the public pages.
 *
 * Everything here is read from the database rather than typed into a template, so a
 * published claim about this league cannot drift from what the league actually did.
 * A methodology page asserting a rulebook version that no longer matches the stored
 * one would be worse than having no methodology page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RulesCheckResult {
  model: string;
  score: number;
  maxScore: number;
  attempts: number;
  passed: boolean;
}

export interface LeagueFacts {
  season: number;
  rulebookVersion: string;
  seedCommitHash: string;
  seedRevealed: string | null;
  budgetTotal: number;
  rulesChecks: RulesCheckResult[];
  rulesCheckContextHash: string | null;
  dossier: { hash: string; tokenCount: number; players: number } | null;
  draftComplete: boolean;
}

export async function loadLeagueFacts(
  db: SupabaseClient,
  season: number,
): Promise<LeagueFacts | null> {
  const { data: seasonRow } = await db
    .from('seasons')
    .select('id, rulebook_version, seed_commit_hash, draft_seed, budget_total, draft_completed_at')
    .eq('year', season)
    .maybeSingle();
  if (!seasonRow) return null;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, models!inner(display_name)')
    .eq('season_id', seasonRow.id);
  const modelOf = new Map(
    (teamRows ?? []).map((t) => [t.id as string, (t.models as unknown as { display_name: string }).display_name]),
  );

  const { data: checkRows } = await db
    .from('rules_checks')
    .select('team_id, score, max_score, attempt, passed')
    .in('team_id', [...modelOf.keys()]);

  // Keep only each team's final attempt — the published score is the one that counts,
  // with the number of attempts alongside it so a retry is never hidden.
  const byTeam = new Map<string, { score: number; max: number; attempt: number; passed: boolean }>();
  for (const row of checkRows ?? []) {
    const current = byTeam.get(row.team_id as string);
    if (!current || (row.attempt as number) > current.attempt) {
      byTeam.set(row.team_id as string, {
        score: row.score as number,
        max: row.max_score as number,
        attempt: row.attempt as number,
        passed: row.passed as boolean,
      });
    }
  }

  const rulesChecks: RulesCheckResult[] = [...byTeam.entries()]
    .map(([teamId, r]) => ({
      model: modelOf.get(teamId) ?? '—',
      score: r.score,
      maxScore: r.max,
      attempts: r.attempt,
      passed: r.passed,
    }))
    .sort((a, b) => a.model.localeCompare(b.model));

  const { data: checkDecision } = await db
    .from('decisions')
    .select('context_hash')
    .eq('season_id', seasonRow.id)
    .eq('type', 'rules_check')
    .limit(1)
    .maybeSingle();

  const { data: dossierRow } = await db
    .from('dossiers')
    .select('content_hash, token_count, content')
    .eq('season_id', seasonRow.id)
    .order('built_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    season,
    rulebookVersion: seasonRow.rulebook_version as string,
    seedCommitHash: seasonRow.seed_commit_hash as string,
    seedRevealed: (seasonRow.draft_seed as string | null) ?? null,
    budgetTotal: seasonRow.budget_total as number,
    rulesChecks,
    rulesCheckContextHash: (checkDecision?.context_hash as string) ?? null,
    dossier: dossierRow
      ? {
          hash: dossierRow.content_hash as string,
          tokenCount: dossierRow.token_count as number,
          players:
            ((dossierRow.content as { players?: unknown[] })?.players ?? []).length,
        }
      : null,
    draftComplete: Boolean(seasonRow.draft_completed_at),
  };
}
