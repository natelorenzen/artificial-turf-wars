/**
 * One model's profile across every season it has a team in.
 *
 * Built to serve both states at once: the 2026 season where nothing has been drafted
 * yet, and the completed 2025 rehearsal where everything has. The same page renders
 * both, so the live team page in August has already been exercised against a full
 * roster and 15 rounds of real reasoning.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COHORT, type Position } from '@/lib/config/league';

export interface TeamRosterEntry {
  playerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  acquiredVia: string;
  round: number | null;
  pickOverall: number | null;
  projSeasonPoints: number | null;
  actualPoints: number | null;
}

export interface TeamPick {
  decisionId: string | null;
  pickOverall: number;
  round: number;
  player: string;
  position: Position;
  headline: string | null;
  closestCall: string | null;
  confidence: number | null;
  unsupportedClaims: string[];
  fallbackApplied: boolean;
  poolNarrowed: boolean;
}

export interface TeamSeason {
  season: number;
  teamId: string;
  draftSlot: number | null;
  auctionBid: number | null;
  faabRemaining: number | null;
  auctionHeadline: string | null;
  auctionDecisionId: string | null;
  rulesCheck: { score: number; maxScore: number; attempts: number; passed: boolean } | null;
  gameplan: {
    positionalStrategy: string;
    auctionStance: string;
    scarcityRead: string;
    riskPosture: string;
    waiverPhilosophy: string;
  } | null;
  roster: TeamRosterEntry[];
  picks: TeamPick[];
  decisions: { count: number; costUsd: number; meanConfidence: number | null; flagged: number };
}

export interface TeamProfile {
  key: string;
  displayName: string;
  lab: string;
  openrouterId: string;
  contextWindow: number;
  priceIn: number;
  priceOut: number | null;
  seasons: TeamSeason[];
}

export function modelByKey(key: string) {
  return COHORT.find((m) => m.key === key) ?? null;
}

export async function loadTeamProfile(
  db: SupabaseClient,
  key: string,
): Promise<TeamProfile | null> {
  const model = modelByKey(key);
  if (!model) return null;

  const { data: modelRow } = await db.from('models').select('id').eq('key', key).maybeSingle();

  const profile: TeamProfile = {
    key: model.key,
    displayName: model.displayName,
    lab: model.lab,
    openrouterId: model.openrouterId,
    contextWindow: model.contextWindow,
    priceIn: model.priceIn,
    priceOut: model.priceOut,
    seasons: [],
  };
  if (!modelRow) return profile;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, season_id, draft_slot, auction_bid, faab_remaining, seasons!inner(year)')
    .eq('model_id', modelRow.id);

  const teams = (teamRows ?? []) as unknown as {
    id: string;
    season_id: string;
    draft_slot: number | null;
    auction_bid: number | null;
    faab_remaining: number | null;
    seasons: { year: number };
  }[];

  for (const team of teams.sort((a, b) => b.seasons.year - a.seasons.year)) {
    profile.seasons.push(await loadSeason(db, team));
  }
  return profile;
}

async function loadSeason(
  db: SupabaseClient,
  team: {
    id: string;
    season_id: string;
    draft_slot: number | null;
    auction_bid: number | null;
    faab_remaining: number | null;
    seasons: { year: number };
  },
): Promise<TeamSeason> {
  const season = team.seasons.year;

  const { data: checkRows } = await db
    .from('rules_checks')
    .select('score, max_score, attempt, passed')
    .eq('team_id', team.id)
    .order('attempt', { ascending: false })
    .limit(1);
  const check = checkRows?.[0];

  const { data: planRow } = await db
    .from('gameplans')
    .select('positional_strategy, auction_stance, scarcity_read, risk_posture, waiver_philosophy')
    .eq('team_id', team.id)
    .maybeSingle();

  const { data: decisionRows } = await db
    .from('decisions')
    .select('type, headline, closest_call, confidence, cost_usd, unsupported_claims, fallback_applied, id')
    .eq('team_id', team.id);
  const decisions = decisionRows ?? [];
  const byId = new Map(decisions.map((d) => [d.id as string, d]));

  const { data: pickRows } = await db
    .from('draft_picks')
    .select('pick_overall, round, decision_id, pool_narrowed, players!inner(name, position)')
    .eq('team_id', team.id)
    .order('pick_overall');

  const picks: TeamPick[] = (pickRows ?? []).map((row) => {
    const p = row.players as unknown as { name: string; position: Position };
    const d = row.decision_id ? byId.get(row.decision_id as string) : undefined;
    return {
      decisionId: (row.decision_id as string) ?? null,
      pickOverall: row.pick_overall as number,
      round: row.round as number,
      player: p.name,
      position: p.position,
      headline: (d?.headline as string) ?? null,
      closestCall: (d?.closest_call as string) ?? null,
      confidence: (d?.confidence as number) ?? null,
      unsupportedClaims: (d?.unsupported_claims as string[]) ?? [],
      fallbackApplied: Boolean(d?.fallback_applied),
      poolNarrowed: Boolean(row.pool_narrowed),
    };
  });

  // Roster, with what each player was projected to score and what they actually did.
  const { data: rosterRows } = await db
    .from('rosters')
    .select('player_id, acquired_via, players!inner(name, position, nfl_team)')
    .eq('team_id', team.id)
    .eq('active', true);

  const playerIds = (rosterRows ?? []).map((r) => r.player_id as string);
  const projections = new Map<string, number>();
  const actuals = new Map<string, number>();

  if (playerIds.length > 0) {
    const { data: projRows } = await db
      .from('player_projections')
      .select('player_id, proj_pts')
      .eq('season', season)
      .in('player_id', playerIds);
    for (const row of projRows ?? []) projections.set(row.player_id as string, Number(row.proj_pts));

    const { data: statRows } = await db
      .from('player_stats')
      .select('player_id, computed_pts')
      .eq('season', season)
      .in('player_id', playerIds);
    for (const row of statRows ?? []) {
      actuals.set(
        row.player_id as string,
        (actuals.get(row.player_id as string) ?? 0) + Number(row.computed_pts),
      );
    }
  }

  const pickLookup = new Map<string, { round: number; overall: number }>();
  for (const row of pickRows ?? []) {
    const p = row.players as unknown as { name: string };
    pickLookup.set(p.name, { round: row.round as number, overall: row.pick_overall as number });
  }

  const roster: TeamRosterEntry[] = (rosterRows ?? [])
    .map((row) => {
      const p = row.players as unknown as { name: string; position: Position; nfl_team: string | null };
      const drafted = pickLookup.get(p.name);
      return {
        playerId: row.player_id as string,
        name: p.name,
        position: p.position,
        nflTeam: p.nfl_team,
        acquiredVia: row.acquired_via as string,
        round: drafted?.round ?? null,
        pickOverall: drafted?.overall ?? null,
        projSeasonPoints: projections.get(row.player_id as string) ?? null,
        actualPoints: actuals.has(row.player_id as string)
          ? Number(actuals.get(row.player_id as string)!.toFixed(1))
          : null,
      };
    })
    .sort((a, b) => (a.pickOverall ?? 999) - (b.pickOverall ?? 999));

  const confidences = decisions
    .map((d) => d.confidence as number | null)
    .filter((c): c is number => c !== null);

  return {
    season,
    teamId: team.id,
    draftSlot: team.draft_slot,
    auctionBid: team.auction_bid,
    faabRemaining: team.faab_remaining,
    auctionHeadline:
      (decisions.find((d) => d.type === 'auction')?.headline as string | undefined) ?? null,
    auctionDecisionId:
      (decisions.find((d) => d.type === 'auction')?.id as string | undefined) ?? null,
    rulesCheck: check
      ? {
          score: check.score as number,
          maxScore: check.max_score as number,
          attempts: check.attempt as number,
          passed: check.passed as boolean,
        }
      : null,
    gameplan: planRow
      ? {
          positionalStrategy: planRow.positional_strategy as string,
          auctionStance: planRow.auction_stance as string,
          scarcityRead: planRow.scarcity_read as string,
          riskPosture: planRow.risk_posture as string,
          waiverPhilosophy: planRow.waiver_philosophy as string,
        }
      : null,
    roster,
    picks,
    decisions: {
      count: decisions.length,
      costUsd: Number(decisions.reduce((s, d) => s + Number(d.cost_usd ?? 0), 0).toFixed(3)),
      meanConfidence:
        confidences.length === 0
          ? null
          : Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)),
      flagged: decisions.filter((d) => ((d.unsupported_claims as string[]) ?? []).length > 0).length,
    },
  };
}
