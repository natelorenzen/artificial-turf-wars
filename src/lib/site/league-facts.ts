/**
 * Live facts for the public pages.
 *
 * Everything here is read from the database rather than typed into a template, so a
 * published claim about this league cannot drift from what the league actually did.
 * A methodology page asserting a rulebook version that no longer matches the stored
 * one would be worse than having no methodology page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIGURED } from '@/lib/supabase';

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
  dossier: {
    hash: string;
    tokenCount: number;
    players: number;
    builtAt: string;
    curves: {
      position: string;
      best: number;
      replacementRank: number;
      replacementPoints: number;
      spread: number;
    }[];
  } | null;
  gameplansFiled: number;
  auctionResolved: boolean;
  draftComplete: boolean;
}

export async function loadLeagueFacts(
  db: SupabaseClient,
  season: number,
): Promise<LeagueFacts | null> {
  if (!SUPABASE_CONFIGURED) return null;
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
    .select('content_hash, token_count, content, built_at')
    .eq('season_id', seasonRow.id)
    .order('built_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: gameplansFiled } = await db
    .from('gameplans')
    .select('*', { count: 'exact', head: true })
    .in('team_id', [...modelOf.keys()]);

  const { count: auctionBids } = await db
    .from('auction_bids')
    .select('*', { count: 'exact', head: true })
    .in('team_id', [...modelOf.keys()]);

  return {
    season,
    rulebookVersion: seasonRow.rulebook_version as string,
    seedCommitHash: seasonRow.seed_commit_hash as string,
    seedRevealed: (seasonRow.draft_seed as string | null) ?? null,
    budgetTotal: seasonRow.budget_total as number,
    rulesChecks,
    rulesCheckContextHash: (checkDecision?.context_hash as string) ?? null,
    dossier: dossierRow ? shapeDossier(dossierRow) : null,
    gameplansFiled: gameplansFiled ?? 0,
    auctionResolved: (auctionBids ?? 0) > 0,
    draftComplete: Boolean(seasonRow.draft_completed_at),
  };
}

interface DossierRow {
  content_hash: string;
  token_count: number;
  built_at: string;
  content: unknown;
}

function shapeDossier(row: DossierRow): NonNullable<LeagueFacts['dossier']> {
  const content = row.content as {
    players?: unknown[];
    scarcity_curves?: {
      position: string;
      points_by_rank: { rank: number; proj_season_points: number }[];
      replacement_rank: number;
      replacement_points: number;
      spread_over_replacement: number;
    }[];
  };

  return {
    hash: row.content_hash,
    tokenCount: row.token_count,
    players: (content.players ?? []).length,
    builtAt: row.built_at,
    curves: (content.scarcity_curves ?? []).map((c) => ({
      position: c.position,
      best: c.points_by_rank[0]?.proj_season_points ?? 0,
      replacementRank: c.replacement_rank,
      replacementPoints: c.replacement_points,
      spread: c.spread_over_replacement,
    })),
  };
}
