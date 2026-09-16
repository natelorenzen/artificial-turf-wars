/**
 * The waiver wire, as the site shows it: every sealed bid once the run has resolved.
 *
 * Bids are keyed by the week just PLAYED — the Tuesday call after week N — and the
 * players they win join for week N+1. The page follows that: `/waivers/1` is the run
 * after week 1.
 *
 * Nothing about a run is shown before Wednesday's resolution. The bids are sealed, and
 * the one time this league spoke about an unresolved run it got the story backwards
 * (see `bidIsResolved`). A sealed run is reported as sealed, with no players and no
 * amounts.
 */

import { supabase } from '@/lib/supabase';
import { round2 } from '@/lib/scoring/engine';
import { bidIsResolved } from '@/lib/engine/faab';
import { SEASON } from '@/lib/site/results';

export interface WaiverBidView {
  model: string;
  modelKey: string;
  add: { id: string; name: string; position: string; nflTeam: string | null };
  drop: { id: string; name: string; position: string };
  bid: number;
  won: boolean;
  losingReason: string | null;
  reasoning: string | null;
}

export interface PlayerContest {
  player: WaiverBidView['add'];
  bids: WaiverBidView[];
  winner: WaiverBidView | null;
  /** Winning bid minus the next-highest. Null when uncontested or unclaimed. */
  margin: number | null;
}

export interface TeamWaiverView {
  model: string;
  modelKey: string;
  decisionId: string | null;
  headline: string | null;
  closestCall: string | null;
  confidence: number | null;
  fallback: boolean;
  bids: WaiverBidView[];
  faabBefore: number | null;
  faabAfter: number | null;
}

export interface ClaimReturn {
  model: string;
  modelKey: string;
  added: string;
  dropped: string;
  paid: number;
  /** Points since joining, through the latest scored week. Null before any is scored. */
  addedPoints: number | null;
  droppedPoints: number | null;
  weeksScored: number;
}

export interface WaiverRun {
  week: number;
  /** True while bids exist that Wednesday has not decided. Nothing else is filled then. */
  sealed: boolean;
  contests: PlayerContest[];
  teams: TeamWaiverView[];
  returns: ClaimReturn[];
  brief: string[];
}

interface TeamRow {
  id: string;
  faab_remaining: number | null;
  models: { key: string; display_name: string };
}

async function seasonContext(season: number) {
  const { data: seasonRow } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  if (!seasonRow) return null;
  const { data } = await supabase
    .from('teams')
    .select('id, faab_remaining, models!inner(key, display_name)')
    .eq('season_id', seasonRow.id);
  const teams = (data ?? []) as unknown as TeamRow[];
  return teams.length ? { seasonId: seasonRow.id as string, teams } : null;
}

/** Every week with a waiver run, newest first, and whether each is still sealed. */
export async function waiverWeeks(season = SEASON): Promise<{ week: number; sealed: boolean }[]> {
  const ctx = await seasonContext(season);
  if (!ctx) return [];
  const { data } = await supabase
    .from('waiver_bids')
    .select('week, won, losing_reason')
    .in('team_id', ctx.teams.map((t) => t.id));
  const byWeek = new Map<number, boolean>();
  for (const row of data ?? []) {
    const week = row.week as number;
    const resolved = bidIsResolved(row as { won: boolean; losing_reason: string | null });
    byWeek.set(week, (byWeek.get(week) ?? false) || !resolved);
  }
  // A week can have waiver DECISIONS and no bids — everyone stood pat — and that run
  // is still worth a page.
  const { data: decisions } = await supabase
    .from('decisions')
    .select('week')
    .eq('season_id', ctx.seasonId)
    .eq('type', 'waiver')
    .is('superseded_reason', null);
  for (const row of decisions ?? []) {
    const week = row.week as number;
    if (!byWeek.has(week)) byWeek.set(week, false);
  }
  return [...byWeek]
    .map(([week, sealed]) => ({ week, sealed }))
    .sort((a, b) => b.week - a.week);
}

export async function loadWaiverRun(week: number, season = SEASON): Promise<WaiverRun | null> {
  const ctx = await seasonContext(season);
  if (!ctx) return null;
  const { seasonId, teams } = ctx;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const teamIds = teams.map((t) => t.id);

  const { data: bidRows } = await supabase
    .from('waiver_bids')
    .select(
      'team_id, bid, won, losing_reason, reasoning, created_at, add_player_id, drop_player_id, ' +
        'add:players!waiver_bids_add_player_id_fkey(name, position, nfl_team), ' +
        'drop:players!waiver_bids_drop_player_id_fkey(name, position)',
    )
    .eq('week', week)
    .in('team_id', teamIds);
  const rows = (bidRows ?? []) as unknown as {
    team_id: string;
    bid: number;
    won: boolean;
    losing_reason: string | null;
    reasoning: string | null;
    add_player_id: string;
    drop_player_id: string;
    add: { name: string; position: string; nfl_team: string | null } | null;
    drop: { name: string; position: string } | null;
  }[];

  const { data: decisionRows } = await supabase
    .from('decisions')
    .select('id, team_id, headline, closest_call, confidence, fallback_applied, provider_failure, created_at')
    .eq('season_id', seasonId)
    .eq('type', 'waiver')
    .eq('week', week)
    .is('superseded_reason', null)
    .order('created_at', { ascending: true });
  if (rows.length === 0 && (decisionRows ?? []).length === 0) return null;

  const sealed = rows.some((row) => !bidIsResolved(row));
  if (sealed) {
    return { week, sealed: true, contests: [], teams: [], returns: [], brief: [] };
  }

  const bids: WaiverBidView[] = rows.map((row) => {
    const team = byId.get(row.team_id)!;
    return {
      model: team.models.display_name,
      modelKey: team.models.key,
      add: {
        id: row.add_player_id,
        name: row.add?.name ?? row.add_player_id,
        position: row.add?.position ?? '',
        nflTeam: row.add?.nfl_team ?? null,
      },
      drop: { id: row.drop_player_id, name: row.drop?.name ?? row.drop_player_id, position: row.drop?.position ?? '' },
      bid: Number(row.bid),
      won: row.won,
      losingReason: row.losing_reason,
      reasoning: row.reasoning,
    };
  });

  // Player by player, most-wanted first.
  const byPlayer = new Map<string, WaiverBidView[]>();
  for (const bid of bids) byPlayer.set(bid.add.id, [...(byPlayer.get(bid.add.id) ?? []), bid]);
  const contests: PlayerContest[] = [...byPlayer.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.bid - a.bid || Number(b.won) - Number(a.won));
      const winner = sorted.find((b) => b.won) ?? null;
      // The next bid the winner actually had to beat — not a bigger one that lost for
      // want of budget.
      const runnerUp = winner ? sorted.find((b) => b !== winner && b.bid <= winner.bid) : undefined;
      return {
        player: sorted[0].add,
        bids: sorted,
        winner,
        margin: winner && runnerUp ? winner.bid - runnerUp.bid : null,
      };
    })
    .sort((a, b) => b.bids.length - a.bids.length || (b.winner?.bid ?? 0) - (a.winner?.bid ?? 0));

  // FAAB: today's balance plus everything won in this run and every later one.
  const { data: laterWins } = await supabase
    .from('waiver_bids')
    .select('team_id, bid, week')
    .in('team_id', teamIds)
    .gte('week', week)
    .eq('won', true);
  const spentFrom = (teamId: string, fromWeek: number) =>
    (laterWins ?? [])
      .filter((r) => r.team_id === teamId && (r.week as number) >= fromWeek)
      .reduce((sum, r) => sum + Number(r.bid), 0);

  const decisionOf = new Map((decisionRows ?? []).map((d) => [d.team_id as string, d]));
  const teamViews: TeamWaiverView[] = teams
    .map((team) => {
      const decision = decisionOf.get(team.id);
      const now = team.faab_remaining;
      return {
        model: team.models.display_name,
        modelKey: team.models.key,
        decisionId: (decision?.id as string | undefined) ?? null,
        headline: (decision?.headline as string | null | undefined) ?? null,
        closestCall: (decision?.closest_call as string | null | undefined) ?? null,
        confidence: decision?.confidence == null ? null : Number(decision.confidence),
        fallback: !decision || Boolean(decision.fallback_applied) || Boolean(decision.provider_failure),
        bids: bids.filter((b) => b.modelKey === team.models.key).sort((a, b) => b.bid - a.bid),
        faabBefore: now === null ? null : now + spentFrom(team.id, week),
        faabAfter: now === null ? null : now + spentFrom(team.id, week + 1),
      };
    })
    .sort((a, b) => b.bids.length - a.bids.length || a.model.localeCompare(b.model));

  const returns = await claimReturns(season, week, bids.filter((b) => b.won));

  return {
    week,
    sealed: false,
    contests,
    teams: teamViews,
    returns,
    brief: waiverBrief(contests, teamViews),
  };
}

/**
 * What each winning claim has produced since, beside the player it replaced.
 *
 * The dropped player's points are counted over the same weeks, wherever that player went —
 * that is the honest comparison: the swap, not the roster.
 */
async function claimReturns(season: number, week: number, winners: WaiverBidView[]): Promise<ClaimReturn[]> {
  if (winners.length === 0) return [];
  const ids = [...new Set(winners.flatMap((w) => [w.add.id, w.drop.id]))];
  const { data } = await supabase
    .from('player_stats')
    .select('player_id, week, computed_pts, status')
    .eq('season', season)
    .gt('week', week)
    .in('player_id', ids);

  // Final beats provisional per player-week (CLAUDE.md rule 3b).
  const resolved = new Map<string, number>();
  const finals = new Set<string>();
  const weeks = new Set<number>();
  for (const row of data ?? []) {
    const key = `${row.player_id}:${row.week}`;
    weeks.add(row.week as number);
    if (finals.has(key)) continue;
    resolved.set(key, Number(row.computed_pts));
    if (row.status === 'final') finals.add(key);
  }
  const total = (id: string) =>
    round2([...resolved].filter(([key]) => key.startsWith(`${id}:`)).reduce((sum, [, pts]) => sum + pts, 0));

  return winners.map((w) => ({
    model: w.model,
    modelKey: w.modelKey,
    added: w.add.name,
    dropped: w.drop.name,
    paid: w.bid,
    addedPoints: weeks.size ? total(w.add.id) : null,
    droppedPoints: weeks.size ? total(w.drop.id) : null,
    weeksScored: weeks.size,
  }));
}

/** The run in a few code-written lines. Exported for the test. */
export function waiverBrief(contests: PlayerContest[], teams: TeamWaiverView[]): string[] {
  const lines: string[] = [];
  const all = contests.flatMap((c) => c.bids);
  const won = all.filter((b) => b.won);
  const bidders = teams.filter((t) => t.bids.length > 0);
  const stoodPat = teams.filter((t) => t.bids.length === 0);

  if (all.length === 0) {
    lines.push('Nobody bid. Every team stood pat.');
    return lines;
  }
  lines.push(
    `${all.length} claim${all.length === 1 ? '' : 's'} from ${bidders.length} team${bidders.length === 1 ? '' : 's'}; ${won.length} won.`,
  );

  const top = [...won].sort((a, b) => b.bid - a.bid)[0];
  if (top) lines.push(`Biggest buy: ${top.model} paid $${top.bid} for ${top.add.name}.`);

  const hottest = contests[0];
  if (hottest && hottest.bids.length > 1) {
    const winnerText = hottest.winner
      ? `${hottest.winner.model} won at $${hottest.winner.bid}${hottest.margin !== null ? `, $${hottest.margin} clear of the next bid` : ''}`
      : 'no claim on that player succeeded';
    lines.push(`Most wanted: ${hottest.player.name}, ${hottest.bids.length} bids. ${winnerText}.`);
  }

  const shutOut = bidders.filter((t) => t.bids.every((b) => !b.won));
  if (shutOut.length > 0) {
    lines.push(`Bid and won nothing: ${shutOut.map((t) => t.model).join(', ')}.`);
  }
  if (stoodPat.length > 0) lines.push(`Stood pat: ${stoodPat.map((t) => t.model).join(', ')}.`);

  const spent = won.reduce((sum, b) => sum + b.bid, 0);
  lines.push(`$${spent} spent across the league.`);
  return lines;
}
