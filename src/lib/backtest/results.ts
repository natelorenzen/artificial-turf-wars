/**
 * Backtest results, loaded from the same tables the run wrote to.
 *
 * Shared by `scripts/backtest.ts --score` and the public `/backtest` page, so the
 * site and the terminal can never disagree about what happened. Nothing here is
 * cached or precomputed into a summary table: the page derives its numbers from the
 * stored picks and stat lines every time, which means a reader is looking at the
 * audit trail rather than at a snapshot of someone's conclusions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE, type Position } from '@/lib/config/league';
import { allPlayWeek, h2hWeek, rankStandings } from '@/lib/engine/allplay';
import { optimalLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { buildLabelMap } from '@/lib/engine/labels';
import { SUPABASE_CONFIGURED } from '@/lib/supabase';

export interface BacktestStanding {
  rank: number;
  teamId: string;
  model: string;
  label: string;
  draftSlot: number;
  bid: number;
  faabLeft: number;
  points: number;
  h2h: string;
  allplay: string;
  earlyQbs: number;
}

export interface BacktestBid {
  decisionId: string | null;
  model: string;
  bid: number;
  assignedSlot: number;
  slotPreference: number[];
  headline: string | null;
  confidence: number | null;
  tiebroken: boolean;
}

export interface BacktestPick {
  decisionId: string | null;
  pickOverall: number;
  round: number;
  model: string;
  label: string;
  player: string;
  position: Position;
  headline: string | null;
  confidence: number | null;
}

export interface BacktestSummary {
  season: number;
  standings: BacktestStanding[];
  bids: BacktestBid[];
  earlyPicks: BacktestPick[];
  totals: {
    picks: number;
    fallbacks: number;
    invalid: number;
    providerFailures: number;
    decisions: number;
    costUsd: number;
    meanConfidence: number | null;
  };
  /** Pearson r between auction bid and season points. */
  bidPointsCorrelation: number;
  qbSplit: { withEarlyQb: { teams: number; meanPoints: number }; without: { teams: number; meanPoints: number } };
}

interface TeamRow {
  id: string;
  model_id: string;
  draft_slot: number | null;
  auction_bid: number | null;
  faab_remaining: number | null;
  models: { display_name: string };
}

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function pearson(pairs: { x: number; y: number }[]): number {
  if (pairs.length < 2) return 0;
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  const cov = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / n;
  const sx = Math.sqrt(pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0) / n);
  const sy = Math.sqrt(pairs.reduce((s, p) => s + (p.y - my) ** 2, 0) / n);
  return sx && sy ? Number((cov / (sx * sy)).toFixed(3)) : 0;
}

export async function loadBacktestSummary(
  db: SupabaseClient,
  season: number,
): Promise<BacktestSummary | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const { data: seasonRow } = await db.from('seasons').select('id').eq('year', season).maybeSingle();
  if (!seasonRow) return null;
  const seasonId = seasonRow.id as string;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, model_id, draft_slot, auction_bid, faab_remaining, models!inner(display_name)')
    .eq('season_id', seasonId);
  const teams = (teamRows ?? []) as unknown as TeamRow[];
  if (teams.length === 0 || teams.some((t) => t.draft_slot === null)) return null;

  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot! })));
  const teamIds = teams.map((t) => t.id);

  // --- rosters -------------------------------------------------------------
  // DRAFTED players only. This page reports what the draft produced, so a waiver add
  // does not belong in it — and without the filter it would be counted anyway, because
  // a dropped player keeps its row with `active = false` rather than disappearing.
  //
  // Filtering was a no-op the day it was added (all 120 rows were `draft`), which is
  // exactly why it was worth adding: the numbers here are published, and the first
  // thing that ever runs waivers against this season would have moved them silently.
  const rosterRows = await pageAll<{ team_id: string; player_id: string; players: { position: Position } }>(
    (from, to) =>
      db
        .from('rosters')
        .select('team_id, player_id, players!inner(position)')
        .in('team_id', teamIds)
        .eq('acquired_via', 'draft')
        .range(from, to) as never,
    'rosters',
  );
  const rosters = new Map<string, { playerId: string; position: Position }[]>();
  for (const row of rosterRows) {
    const list = rosters.get(row.team_id) ?? [];
    list.push({ playerId: row.player_id, position: row.players.position });
    rosters.set(row.team_id, list);
  }

  // --- actual weekly points ------------------------------------------------
  const statRows = await pageAll<{ player_id: string; week: number; computed_pts: number }>(
    (from, to) =>
      db
        .from('player_stats')
        .select('player_id, week, computed_pts')
        .eq('season', season)
        .lte('week', LEAGUE.regularSeasonWeeks)
        .range(from, to) as never,
    'player_stats',
  );
  const points = new Map<string, Map<number, number>>();
  for (const row of statRows) {
    const byWeek = points.get(row.player_id) ?? new Map<number, number>();
    byWeek.set(row.week, Number(row.computed_pts));
    points.set(row.player_id, byWeek);
  }

  const { data: schedule } = await db
    .from('h2h_schedule')
    .select('week, home_team_id, away_team_id')
    .eq('season_id', seasonId);

  // --- simulate the fourteen weeks ----------------------------------------
  const totals = new Map<string, number>();
  const allplay = new Map<string, { w: number; l: number }>();
  const h2h = new Map<string, { w: number; l: number; t: number }>();
  for (const t of teams) {
    totals.set(t.id, 0);
    allplay.set(t.id, { w: 0, l: 0 });
    h2h.set(t.id, { w: 0, l: 0, t: 0 });
  }

  for (let week = 1; week <= LEAGUE.regularSeasonWeeks; week++) {
    const weekScores = teams.map((t) => {
      const roster: LineupPlayer[] = (rosters.get(t.id) ?? []).map((p) => ({
        playerId: p.playerId,
        position: p.position,
        points: points.get(p.playerId)?.get(week) ?? 0,
      }));
      // Optimal lineup isolates ROSTER quality from lineup-setting skill. Nobody set
      // a lineup in this backtest, so grading them on one would invent a result.
      return { teamId: t.id, points: optimalLineup(roster).total };
    });

    for (const s of weekScores) totals.set(s.teamId, (totals.get(s.teamId) ?? 0) + s.points);
    for (const rec of allPlayWeek(weekScores)) {
      const a = allplay.get(rec.teamId)!;
      a.w += rec.wins;
      a.l += rec.losses;
    }
    for (const [teamId, outcome] of h2hWeek(
      (schedule ?? [])
        .filter((m) => m.week === week)
        .map((m) => ({ homeTeamId: m.home_team_id as string, awayTeamId: m.away_team_id as string })),
      weekScores,
    )) {
      const r = h2h.get(teamId)!;
      if (outcome === 'W') r.w++;
      else if (outcome === 'L') r.l++;
      else r.t++;
    }
  }

  // --- draft picks ---------------------------------------------------------
  const pickRows = await pageAll<{
    pick_overall: number;
    round: number;
    team_id: string;
    decision_id: string | null;
    players: { name: string; position: Position };
  }>(
    (from, to) =>
      db
        .from('draft_picks')
        .select('pick_overall, round, team_id, decision_id, players!inner(name, position)')
        .eq('season_id', seasonId)
        .order('pick_overall')
        .range(from, to) as never,
    'draft_picks',
  );

  const earlyQbs = new Map<string, number>();
  for (const pick of pickRows) {
    if (pick.round <= 3 && pick.players.position === 'QB') {
      earlyQbs.set(pick.team_id, (earlyQbs.get(pick.team_id) ?? 0) + 1);
    }
  }

  // --- decisions -----------------------------------------------------------
  const decisionRows = await pageAll<{
    id: string;
    type: string;
    team_id: string | null;
    headline: string | null;
    confidence: number | null;
    valid: boolean;
    fallback_applied: boolean;
    provider_failure: boolean;
    cost_usd: number | null;
  }>(
    (from, to) =>
      db
        .from('decisions')
        .select('id, type, team_id, headline, confidence, valid, fallback_applied, provider_failure, cost_usd')
        .eq('season_id', seasonId)
        .range(from, to) as never,
    'decisions',
  );
  const decisionById = new Map(decisionRows.map((d) => [d.id, d]));
  const draftDecisions = decisionRows.filter((d) => d.type === 'draft_pick');
  const confidences = draftDecisions.map((d) => d.confidence).filter((c): c is number => c !== null);

  // --- auction -------------------------------------------------------------
  const { data: bidRows } = await db
    .from('auction_bids')
    .select('team_id, bid, slot_preference, assigned_slot, tiebroken, decision_id')
    .in('team_id', teamIds);

  const modelOf = new Map(teams.map((t) => [t.id, t.models.display_name]));

  const bids: BacktestBid[] = (bidRows ?? [])
    .map((row) => {
      const decision = row.decision_id ? decisionById.get(row.decision_id as string) : undefined;
      return {
        decisionId: (row.decision_id as string) ?? null,
        model: modelOf.get(row.team_id as string) ?? '—',
        bid: row.bid as number,
        assignedSlot: row.assigned_slot as number,
        slotPreference: (row.slot_preference ?? []) as number[],
        headline: decision?.headline ?? null,
        confidence: decision?.confidence ?? null,
        tiebroken: Boolean(row.tiebroken),
      };
    })
    .sort((a, b) => a.assignedSlot - b.assignedSlot);

  // --- standings -----------------------------------------------------------
  const ranked = rankStandings(
    teams.map((t) => ({
      teamId: t.id,
      h2hW: h2h.get(t.id)!.w,
      h2hL: h2h.get(t.id)!.l,
      h2hT: h2h.get(t.id)!.t,
      allplayW: allplay.get(t.id)!.w,
      allplayL: allplay.get(t.id)!.l,
      cumPts: totals.get(t.id) ?? 0,
    })),
  );

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const standings: BacktestStanding[] = ranked.map((row) => {
    const team = teamById.get(row.teamId)!;
    return {
      rank: row.rank,
      teamId: row.teamId,
      model: team.models.display_name,
      label: labels.get(row.teamId)!,
      draftSlot: team.draft_slot!,
      bid: team.auction_bid ?? 0,
      faabLeft: team.faab_remaining ?? LEAGUE.budgetTotal,
      points: row.cumPts,
      h2h: `${row.h2hW}-${row.h2hL}${row.h2hT ? `-${row.h2hT}` : ''}`,
      allplay: `${row.allplayW}-${row.allplayL}`,
      earlyQbs: earlyQbs.get(row.teamId) ?? 0,
    };
  });

  const withQb = standings.filter((s) => s.earlyQbs > 0);
  const withoutQb = standings.filter((s) => s.earlyQbs === 0);
  const mean = (rows: BacktestStanding[]) =>
    rows.length === 0 ? 0 : Number((rows.reduce((s, r) => s + r.points, 0) / rows.length).toFixed(1));

  return {
    season,
    standings,
    bids,
    earlyPicks: pickRows
      .filter((p) => p.round <= 2)
      .map((p) => {
        const decision = p.decision_id ? decisionById.get(p.decision_id) : undefined;
        return {
          decisionId: p.decision_id ?? null,
          pickOverall: p.pick_overall,
          round: p.round,
          model: modelOf.get(p.team_id) ?? '—',
          label: labels.get(p.team_id) ?? '—',
          player: p.players.name,
          position: p.players.position,
          headline: decision?.headline ?? null,
          confidence: decision?.confidence ?? null,
        };
      }),
    totals: {
      picks: pickRows.length,
      fallbacks: draftDecisions.filter((d) => d.fallback_applied).length,
      invalid: draftDecisions.filter((d) => !d.valid).length,
      providerFailures: decisionRows.filter((d) => d.provider_failure).length,
      decisions: decisionRows.length,
      costUsd: Number(decisionRows.reduce((s, d) => s + Number(d.cost_usd ?? 0), 0).toFixed(2)),
      meanConfidence:
        confidences.length === 0
          ? null
          : Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)),
    },
    bidPointsCorrelation: pearson(standings.map((s) => ({ x: s.bid, y: s.points }))),
    qbSplit: {
      withEarlyQb: { teams: withQb.length, meanPoints: mean(withQb) },
      without: { teams: withoutQb.length, meanPoints: mean(withoutQb) },
    },
  };
}

// ---------------------------------------------------------------------------
// Full draft board
// ---------------------------------------------------------------------------

export interface BoardPick extends BacktestPick {
  closestCall: string | null;
  citedFields: string[];
  unsupportedClaims: string[];
  softViolations: string[];
  fallbackApplied: boolean;
  poolNarrowed: boolean;
}

/**
 * Every pick, with the reasoning attached. This is the draft-board page for both the
 * backtest and the live season — the same component reads both, so the August board
 * has already been exercised against 120 real picks.
 */
export async function loadDraftBoard(db: SupabaseClient, season: number): Promise<BoardPick[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const { data: seasonRow } = await db.from('seasons').select('id').eq('year', season).maybeSingle();
  if (!seasonRow) return [];
  const seasonId = seasonRow.id as string;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, draft_slot, models!inner(display_name)')
    .eq('season_id', seasonId);
  const teams = (teamRows ?? []) as unknown as TeamRow[];
  if (teams.length === 0 || teams.some((t) => t.draft_slot === null)) return [];
  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot! })));
  const modelOf = new Map(teams.map((t) => [t.id, t.models.display_name]));

  const picks = await pageAll<{
    pick_overall: number;
    round: number;
    team_id: string;
    decision_id: string | null;
    pool_narrowed: boolean;
    players: { name: string; position: Position };
  }>(
    (from, to) =>
      db
        .from('draft_picks')
        .select('pick_overall, round, team_id, decision_id, pool_narrowed, players!inner(name, position)')
        .eq('season_id', seasonId)
        .order('pick_overall')
        .range(from, to) as never,
    'draft_picks',
  );

  const decisions = await pageAll<{
    id: string;
    headline: string | null;
    closest_call: string | null;
    confidence: number | null;
    cited_fields: string[] | null;
    unsupported_claims: string[] | null;
    soft_violations: string[] | null;
    fallback_applied: boolean;
  }>(
    (from, to) =>
      db
        .from('decisions')
        .select('id, headline, closest_call, confidence, cited_fields, unsupported_claims, soft_violations, fallback_applied')
        .eq('season_id', seasonId)
        .eq('type', 'draft_pick')
        .range(from, to) as never,
    'decisions',
  );
  const byId = new Map(decisions.map((d) => [d.id, d]));

  return picks.map((pick) => {
    const d = pick.decision_id ? byId.get(pick.decision_id) : undefined;
    return {
      decisionId: pick.decision_id ?? null,
      pickOverall: pick.pick_overall,
      round: pick.round,
      model: modelOf.get(pick.team_id) ?? '—',
      label: labels.get(pick.team_id) ?? '—',
      player: pick.players.name,
      position: pick.players.position,
      headline: d?.headline ?? null,
      confidence: d?.confidence ?? null,
      closestCall: d?.closest_call ?? null,
      citedFields: d?.cited_fields ?? [],
      unsupportedClaims: d?.unsupported_claims ?? [],
      softViolations: d?.soft_violations ?? [],
      fallbackApplied: Boolean(d?.fallback_applied),
      poolNarrowed: Boolean(pick.pool_narrowed),
    };
  });
}
