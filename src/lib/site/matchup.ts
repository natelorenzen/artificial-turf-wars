/**
 * One head-to-head game, slot by slot — the box score a reader clicks into.
 *
 * Built for the same three states the front page already distinguishes, because a
 * matchup link is shown in all three and must never 404 or lie in any of them:
 *
 *   - `final` / `provisional` — the week has been scored. Starter points come from
 *     `lineup_scores.per_slot`, the exact rows the standings were built from, so this
 *     page cannot disagree with the table. Final beats provisional, as everywhere.
 *   - `live` — the slate is being played. Starter points come from `live_scores`, which
 *     is never authoritative (CLAUDE.md rule 3c) and is labelled as such. Bench points
 *     are unknown in this state and shown as unknown, not as zero.
 *   - `upcoming` — lineups are locked and nothing has been played. Projections only.
 *
 * The "how it was decided" lines are deterministic, like the rest of the commissioner
 * (hard rule 1). A model asked to summarise a game would sometimes miss the bench
 * decision that flipped it; code never does, and never embellishes.
 */

import { FLEX_ELIGIBLE, type Position, type StarterSlot } from '@/lib/config/league';
import { supabase } from '@/lib/supabase';
import { round2 } from '@/lib/scoring/engine';
import { standingsThroughWeek } from '@/lib/scoring/week';
import { SEASON } from '@/lib/site/results';
import { autopilotLineup, compareToAutopilot, loadLockedWeek } from '@/lib/weekly/autopilot';
import type { Lineup } from '@/lib/engine/lineup';

export type MatchupStatus = 'final' | 'provisional' | 'live' | 'upcoming';

export interface BoxPlayer {
  playerId: string;
  name: string;
  position: Position | string;
  nflTeam: string | null;
  /** "v DAL", "@ PHI", or "BYE". Null when the schedule has no row for the team. */
  opponent: string | null;
  /** Null means not known yet — never "scored zero". */
  points: number | null;
  projected: number | null;
}

export interface BoxSlot {
  slot: StarterSlot;
  player: BoxPlayer | null;
}

export interface BenchPlayer extends BoxPlayer {
  /** The starter this player outscored and could legally have replaced, if any. */
  outscored: { name: string; slot: StarterSlot; points: number } | null;
}

export interface AutopilotView {
  /** What the league's code would have started, scored. Null until the week is scored. */
  points: number | null;
  /** This lineup minus the autopilot's. Zero means the same nine. */
  delta: number | null;
  swaps: { started: BoxPlayer | null; benched: BoxPlayer | null; delta: number | null }[];
}

export interface MatchupSide {
  model: string;
  modelKey: string;
  points: number | null;
  projected: number;
  record: string | null;
  rank: number | null;
  starters: BoxSlot[];
  bench: BenchPlayer[];
  /** Best lineup this roster could have started, once the week is scored. */
  optimal: number | null;
  efficiency: number | null;
  /** The model's calls against the lineup code would have set. Null with no stored prompt. */
  autopilot: AutopilotView | null;
  lineup: {
    decisionId: string | null;
    headline: string | null;
    closestCall: string | null;
    confidence: number | null;
    /** The code chose this lineup, not the model. Always shown when true. */
    fallback: boolean;
  };
}

export interface MatchupView {
  season: number;
  week: number;
  slug: string;
  status: MatchupStatus;
  /** When live numbers were computed, ISO. Only set for `live`. */
  computedAt: string | null;
  home: MatchupSide;
  away: MatchupSide;
  story: string[];
}

export interface FixtureLink {
  home: { model: string; modelKey: string };
  away: { model: string; modelKey: string };
  slug: string;
}

export function matchupSlug(homeKey: string, awayKey: string): string {
  return `${homeKey}-vs-${awayKey}`;
}

export function matchupHref(week: number, homeKey: string, awayKey: string): string {
  return `/results/${week}/${matchupSlug(homeKey, awayKey)}`;
}

const SLOT_ORDER: StarterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

interface TeamRow {
  id: string;
  models: { key: string; display_name: string };
}

async function seasonRowId(season: number): Promise<string | null> {
  const { data } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function loadTeams(seasonId: string): Promise<TeamRow[]> {
  const { data } = await supabase
    .from('teams')
    .select('id, models!inner(key, display_name)')
    .eq('season_id', seasonId);
  return (data ?? []) as unknown as TeamRow[];
}

/** Every fixture of a week, with the slug its box score lives at. */
export async function loadFixtureLinks(week: number, season = SEASON): Promise<FixtureLink[]> {
  const seasonId = await seasonRowId(season);
  if (!seasonId) return [];
  const teams = await loadTeams(seasonId);
  const byId = new Map(teams.map((t) => [t.id, t.models]));

  const { data } = await supabase
    .from('h2h_schedule')
    .select('home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .eq('week', week);

  return (data ?? []).flatMap((row) => {
    const home = byId.get(row.home_team_id as string);
    const away = byId.get(row.away_team_id as string);
    if (!home || !away) return [];
    return [
      {
        home: { model: home.display_name, modelKey: home.key },
        away: { model: away.display_name, modelKey: away.key },
        slug: matchupSlug(home.key, away.key),
      },
    ];
  });
}

export async function loadMatchup(
  week: number,
  slug: string,
  season = SEASON,
): Promise<MatchupView | null> {
  const seasonId = await seasonRowId(season);
  if (!seasonId) return null;

  const [homeKey, awayKey] = slug.split('-vs-');
  if (!homeKey || !awayKey) return null;

  const teams = await loadTeams(seasonId);
  const homeTeam = teams.find((t) => t.models.key === homeKey);
  const awayTeam = teams.find((t) => t.models.key === awayKey);
  if (!homeTeam || !awayTeam) return null;

  // Only a fixture that was actually scheduled has a page. Any two keys would otherwise
  // render a plausible-looking game that never happened.
  const { data: fixture } = await supabase
    .from('h2h_schedule')
    .select('id')
    .eq('season_id', seasonId)
    .eq('week', week)
    .eq('home_team_id', homeTeam.id)
    .eq('away_team_id', awayTeam.id)
    .maybeSingle();
  if (!fixture) return null;

  const teamIds = [homeTeam.id, awayTeam.id];

  const { data: lineupRows } = await supabase
    .from('lineups')
    .select(
      'id, team_id, qb, rb, wr, te, flex, k, def, decision_id, carried_forward, locked_at, decisions(headline, closest_call, confidence, fallback_applied, provider_failure)',
    )
    .eq('week', week)
    .in('team_id', teamIds);
  const lineups = new Map((lineupRows ?? []).map((row) => [row.team_id as string, row]));
  // No lineup on either side means the week has not been set yet. Nothing to show.
  if (lineups.size === 0) return null;

  const lineupIds = (lineupRows ?? []).map((r) => r.id as string);
  const { data: scoreRows } = await supabase
    .from('lineup_scores')
    .select('lineup_id, status, total_pts, optimal_pts, efficiency, per_slot')
    .in('lineup_id', lineupIds);
  const official = new Map<string, NonNullable<typeof scoreRows>[number]>();
  for (const row of scoreRows ?? []) {
    const current = official.get(row.lineup_id as string);
    if (current?.status === 'final' && row.status !== 'final') continue;
    official.set(row.lineup_id as string, row);
  }

  const { data: liveRows } = await supabase
    .from('live_scores')
    .select('team_id, total_pts, per_slot, computed_at')
    .eq('week', week)
    .in('team_id', teamIds);
  const live = new Map((liveRows ?? []).map((row) => [row.team_id as string, row]));

  const scored = official.size > 0;
  const status: MatchupStatus = scored
    ? [...official.values()].every((r) => r.status === 'final')
      ? 'final'
      : 'provisional'
    : live.size > 0
      ? 'live'
      : 'upcoming';

  // What the models were shown at lock, from the stored prompts: every rostered player
  // with the projection, injury tag and bye flag of that moment. Never the live
  // projections table, which the daily ingest used to rewrite until the last kickoff.
  const locked = await loadLockedWeek(supabase, week, teamIds, seasonId);
  const projections = new Map(
    [...locked.projections].filter((entry): entry is [string, number] => entry[1] !== null),
  );

  // The roster at lock where a prompt recorded it. Otherwise, the roster table's history:
  // acquired by then and not yet dropped, the same rule the ratings page used.
  const heldBy = new Map<string, string[]>();
  for (const [teamId, roster] of locked.rosterOf) heldBy.set(teamId, roster.map((e) => e.player_id));
  const { data: rosterRows } = await supabase
    .from('rosters')
    .select('team_id, player_id, acquired_week, dropped_week')
    .in('team_id', teamIds.filter((id) => !locked.rosterOf.has(id)));
  for (const row of rosterRows ?? []) {
    const acquired = (row.acquired_week as number | null) ?? 0;
    const dropped = row.dropped_week as number | null;
    if (acquired > week || (dropped !== null && dropped <= week)) continue;
    const list = heldBy.get(row.team_id as string) ?? [];
    list.push(row.player_id as string);
    heldBy.set(row.team_id as string, list);
  }

  const playerIds = new Set<string>();
  for (const list of heldBy.values()) list.forEach((id) => playerIds.add(id));
  for (const row of lineups.values()) {
    for (const id of [row.qb, ...(row.rb ?? []), ...(row.wr ?? []), row.te, row.flex, row.k, row.def]) {
      if (id) playerIds.add(id as string);
    }
  }
  const ids = [...playerIds];

  const { data: playerRows } = await supabase
    .from('players')
    .select('sleeper_id, name, position, nfl_team')
    .in('sleeper_id', ids);
  const players = new Map((playerRows ?? []).map((p) => [p.sleeper_id as string, p]));

  // Final beats provisional (CLAUDE.md rule 3b). Only read once scored: before Tuesday
  // there are no rows, and a live week never writes here.
  const points = new Map<string, number>();
  if (scored) {
    const { data: statRows } = await supabase
      .from('player_stats')
      .select('player_id, computed_pts, status')
      .eq('season', season)
      .eq('week', week)
      .in('player_id', ids);
    const finals = new Set<string>();
    for (const row of statRows ?? []) {
      const id = row.player_id as string;
      if (finals.has(id)) continue;
      points.set(id, round2(Number(row.computed_pts)));
      if (row.status === 'final') finals.add(id);
    }
  }

  const { data: gameRows } = await supabase
    .from('nfl_games')
    .select('home, away')
    .eq('season', season)
    .eq('week', week)
    .eq('season_type', 'regular');
  const opponentOf = new Map<string, string>();
  for (const game of gameRows ?? []) {
    opponentOf.set(game.home as string, `v\u00a0${game.away}`);
    opponentOf.set(game.away as string, `@\u00a0${game.home}`);
  }
  const scheduleKnown = (gameRows ?? []).length > 0;

  const { data: standingRows } = await supabase
    .from('standings')
    .select('team_id, h2h_w, h2h_l, h2h_t, rank')
    .eq('week', standingsThroughWeek(week))
    .in('team_id', teamIds);
  const standings = new Map((standingRows ?? []).map((r) => [r.team_id as string, r]));

  const box = (playerId: string, livePoints?: number): BoxPlayer => {
    const player = players.get(playerId);
    const nflTeam = (player?.nfl_team as string | null) ?? (player?.position === 'DEF' ? playerId : null);
    return {
      playerId,
      name: (player?.name as string | undefined) ?? playerId,
      position: (player?.position as string | undefined) ?? '',
      nflTeam,
      opponent: nflTeam && scheduleKnown ? (opponentOf.get(nflTeam) ?? 'BYE') : null,
      points: livePoints ?? (scored ? (points.get(playerId) ?? 0) : null),
      projected: projections.get(playerId) ?? null,
    };
  };

  const side = (team: TeamRow): MatchupSide => {
    const lineup = lineups.get(team.id);
    const score = lineup ? official.get(lineup.id as string) : undefined;
    const liveRow = live.get(team.id);
    const perSlot = ((score?.per_slot ?? liveRow?.per_slot ?? []) as {
      slot: StarterSlot;
      playerId: string | null;
      points: number;
    }[]);

    // Slot order follows the lineup row, which is the decision; per_slot supplies points.
    const slotPoints = new Map<string, number>();
    for (const s of perSlot) if (s.playerId) slotPoints.set(`${s.slot}:${s.playerId}`, Number(s.points));

    const chosen: (string | null)[] = lineup
      ? [
          lineup.qb as string | null,
          ...padTo((lineup.rb ?? []) as string[], 2),
          ...padTo((lineup.wr ?? []) as string[], 2),
          lineup.te as string | null,
          lineup.flex as string | null,
          lineup.k as string | null,
          lineup.def as string | null,
        ]
      : SLOT_ORDER.map(() => null);

    const starters: BoxSlot[] = SLOT_ORDER.map((slot, i) => {
      const id = chosen[i];
      if (!id) return { slot, player: null };
      const fromSlot = slotPoints.get(`${slot}:${id}`);
      // Scored weeks read per-player stats (same numbers per_slot was built from);
      // a live week has only per_slot, so its value is passed through.
      return { slot, player: box(id, scored ? undefined : fromSlot) };
    });

    const starterIds = new Set(chosen.filter(Boolean) as string[]);
    const bench: BenchPlayer[] = (heldBy.get(team.id) ?? [])
      .filter((id) => !starterIds.has(id))
      .map((id) => ({ ...box(id), outscored: null as BenchPlayer['outscored'] }))
      .sort((a, b) => benchOrder(a) - benchOrder(b) || (b.points ?? b.projected ?? 0) - (a.points ?? a.projected ?? 0));

    if (scored) flagBenchMisses(starters, bench);

    const lockRoster = locked.rosterOf.get(team.id);
    let autopilot: AutopilotView | null = null;
    if (lineup && lockRoster && lockRoster.length > 0) {
      const positionOf = new Map(lockRoster.map((e) => [e.player_id, e.position]));
      const comparison = compareToAutopilot({
        chosen: {
          qb: lineup.qb as string | null,
          rb: (lineup.rb ?? []) as string[],
          wr: (lineup.wr ?? []) as string[],
          te: lineup.te as string | null,
          flex: lineup.flex as string | null,
          k: lineup.k as string | null,
          def: lineup.def as string | null,
        } satisfies Lineup,
        autopilot: autopilotLineup(lockRoster),
        positionOf: (id) => positionOf.get(id) ?? '',
        projected: (id) => projections.get(id) ?? null,
        actual: scored ? (id) => points.get(id) ?? 0 : null,
      });
      autopilot = {
        points: comparison.autopilotPoints,
        delta: comparison.delta,
        swaps: comparison.swaps.map((swap) => ({
          started: swap.started ? box(swap.started.playerId) : null,
          benched: swap.benched ? box(swap.benched.playerId) : null,
          delta: swap.delta,
        })),
      };
    }

    const decision = lineup?.decisions as unknown as {
      headline: string | null;
      closest_call: string | null;
      confidence: number | null;
      fallback_applied: boolean;
      provider_failure: boolean;
    } | null;
    const standing = standings.get(team.id);
    const t = Number(standing?.h2h_t ?? 0);

    return {
      model: team.models.display_name,
      modelKey: team.models.key,
      points: score
        ? round2(Number(score.total_pts))
        : liveRow
          ? round2(Number(liveRow.total_pts))
          : null,
      projected: round2(
        starters.reduce((sum, s) => sum + (s.player?.projected ?? 0), 0),
      ),
      record: standing ? `${standing.h2h_w}-${standing.h2h_l}${t > 0 ? `-${t}` : ''}` : null,
      rank: standing?.rank == null ? null : Number(standing.rank),
      starters,
      bench,
      optimal: score ? round2(Number(score.optimal_pts)) : null,
      efficiency: score ? Number(score.efficiency) : null,
      autopilot,
      lineup: {
        decisionId: (lineup?.decision_id as string | null) ?? null,
        headline: decision?.headline ?? null,
        closestCall: decision?.closest_call ?? null,
        confidence: decision?.confidence ?? null,
        fallback:
          !!lineup &&
          (!lineup.decision_id ||
            Boolean(lineup.carried_forward) ||
            Boolean(decision?.fallback_applied) ||
            Boolean(decision?.provider_failure)),
      },
    };
  };

  const home = side(homeTeam);
  const away = side(awayTeam);

  return {
    season,
    week,
    slug,
    status,
    computedAt:
      status === 'live'
        ? ([...live.values()].map((r) => r.computed_at as string).sort().at(-1) ?? null)
        : null,
    home,
    away,
    story: matchupStory({ status, home, away }),
  };
}

function padTo(ids: (string | null)[], n: number): (string | null)[] {
  return [...ids, ...Array(Math.max(0, n - ids.length)).fill(null)].slice(0, n);
}

/** "+9.70", "−26.80", "0.00". A real minus sign, so the column reads as figures. */
export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n).toFixed(2)}`;
}

/** One side's calls against the autopilot, as a sentence. Null when it cannot be judged. */
export function autopilotLine(side: MatchupSide): string | null {
  const auto = side.autopilot;
  if (!auto || auto.delta === null) return null;
  if (auto.swaps.length === 0) return `${side.model} started exactly the nine the autopilot would have.`;
  const calls = auto.swaps.map((swap) => {
    const d = swap.delta === null ? '' : ` (${signed(swap.delta)})`;
    if (swap.started && swap.benched) return `${swap.started.name} over ${swap.benched.name}${d}`;
    if (swap.started) return `started ${swap.started.name}${d}`;
    return `benched ${swap.benched!.name}${d}`;
  });
  return `${side.model}'s own calls were worth ${signed(auto.delta)} against the autopilot: ${calls.join('; ')}.`;
}

const POSITION_RANK: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
function benchOrder(p: BoxPlayer): number {
  return POSITION_RANK[p.position] ?? 9;
}

/**
 * Mark each bench player who outscored a starter they could legally have replaced.
 *
 * A bench RB is compared with the weaker of the team's RB starters and its FLEX (if the
 * FLEX holds a flex-eligible player — it always does). Only the single lowest eligible
 * starter is named, because that is the swap a manager would actually have made.
 */
export function flagBenchMisses(starters: BoxSlot[], bench: BenchPlayer[]): void {
  for (const player of bench) {
    if (player.points === null || player.opponent === 'BYE') continue;
    const eligible = starters.filter(
      (s) =>
        s.player &&
        s.player.points !== null &&
        (s.slot === player.position ||
          (s.slot === 'FLEX' && FLEX_ELIGIBLE.includes(player.position as Position))),
    );
    const weakest = eligible.sort((a, b) => a.player!.points! - b.player!.points!)[0];
    if (weakest && player.points > weakest.player!.points!) {
      player.outscored = {
        name: weakest.player!.name,
        slot: weakest.slot,
        points: weakest.player!.points!,
      };
    }
  }
}

/**
 * The game in a few plain sentences, computed rather than written.
 *
 * Exported for the test, and because the order matters: result first, then what
 * decided it, then the bench decision that could have changed it.
 */
export function matchupStory(input: {
  status: MatchupStatus;
  home: MatchupSide;
  away: MatchupSide;
}): string[] {
  const { status, home, away } = input;
  const lines: string[] = [];
  const fmt = (n: number) => n.toFixed(2);

  if (status === 'upcoming') {
    const [fav, dog] = home.projected >= away.projected ? [home, away] : [away, home];
    lines.push(
      `${fav.model} starts the week projected ${fmt(fav.projected)} to ${fmt(dog.projected)} — a ${fmt(fav.projected - dog.projected)}-point edge on paper.`,
    );
    return lines;
  }

  if (home.points === null || away.points === null) return lines;

  const tied = home.points === away.points;
  const [winner, loser] = home.points >= away.points ? [home, away] : [away, home];
  const margin = round2(winner.points! - loser.points!);

  if (status === 'live') {
    lines.push(
      tied
        ? `Level at ${fmt(home.points)} so far.`
        : `${winner.model} leads ${fmt(winner.points!)}–${fmt(loser.points!)} with games still to play. Unofficial until Tuesday.`,
    );
  } else if (tied) {
    lines.push(`A tie at ${fmt(home.points)} — worth half a win each.`);
  } else {
    lines.push(
      `${winner.model} beat ${loser.model} ${fmt(winner.points!)}–${fmt(loser.points!)}, a margin of ${fmt(margin)}.`,
    );
  }

  // Top scorer on the field.
  const all = [home, away].flatMap((team) =>
    team.starters
      .filter((s) => s.player && s.player.points !== null)
      .map((s) => ({ team, player: s.player! })),
  );
  const top = all.sort((a, b) => b.player.points! - a.player.points!)[0];
  if (top && top.player.points! > 0) {
    lines.push(
      `Top performer: ${top.player.name} (${top.player.position}) with ${fmt(top.player.points!)} for ${top.team.model}.`,
    );
  }

  // Biggest slot-for-slot swing, which is usually where the game was won.
  let swing: { slot: StarterSlot; diff: number; ahead: MatchupSide; a: BoxPlayer; b: BoxPlayer } | null = null;
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    const a = home.starters[i]?.player;
    const b = away.starters[i]?.player;
    if (!a || !b || a.points === null || b.points === null) continue;
    const diff = Math.abs(a.points - b.points);
    if (!swing || diff > swing.diff) {
      swing =
        a.points >= b.points
          ? { slot: SLOT_ORDER[i], diff, ahead: home, a, b }
          : { slot: SLOT_ORDER[i], diff, ahead: away, a: b, b: a };
    }
  }
  if (swing && swing.diff >= 5) {
    lines.push(
      `Biggest swing at ${swing.slot}: ${swing.a.name} outscored ${swing.b.name} by ${fmt(swing.diff)} for ${swing.ahead.model}.`,
    );
  }

  if (status === 'live') return lines;

  // The model's judgment, measured against the code that would otherwise have set the
  // lineup. This is the decision the model actually made, so it leads.
  for (const side of [winner, loser]) {
    const line = autopilotLine(side);
    if (line) lines.push(line);
  }
  const wa = winner.autopilot?.points ?? null;
  const la = loser.autopilot?.points ?? null;
  if (!tied && wa !== null && la !== null && la > wa) {
    lines.push(
      `On autopilot, ${loser.model} would have won ${fmt(la)}–${fmt(wa)}. The lineup calls decided this game.`,
    );
  }

  if (tied) return lines;

  // Hindsight: the best lineup the roster held. Luck as much as judgment, so it follows.
  if (loser.optimal !== null && loser.optimal > winner.points!) {
    const miss = loser.bench
      .filter((p) => p.outscored)
      .sort((a, b) => b.points! - b.outscored!.points - (a.points! - a.outscored!.points))[0];
    lines.push(
      `${loser.model}'s best possible lineup scored ${fmt(loser.optimal)}, enough to win. ` +
        (miss
          ? `The costliest call: ${miss.name} (${fmt(miss.points!)}) sat while ${miss.outscored!.name} started at ${miss.outscored!.slot} (${fmt(miss.outscored!.points)}).`
          : `It left ${fmt(loser.optimal - loser.points!)} on the bench.`),
    );
  } else if (loser.optimal !== null) {
    lines.push(
      `No lineup ${loser.model} could have set would have won — its best possible was ${fmt(loser.optimal)}.`,
    );
  }

  // The underdog note, once projections exist on both sides.
  if (winner.projected > 0 && loser.projected > winner.projected) {
    lines.push(
      `${winner.model} won as the underdog, projected ${fmt(winner.projected)} to ${fmt(loser.projected)} at lock.`,
    );
  }

  return lines;
}

/**
 * The whole week in a handful of lines, for the top of `/results/[week]`.
 *
 * Deterministic, and therefore always there. The beat writer's column needs a human to
 * release it, which is right for a byline and wrong for "who won": a reader arriving on
 * Tuesday should not find a week with no summary because nobody has read the column yet.
 */
export function weekBrief(input: {
  views: MatchupView[];
  luck: { model: string; note: string }[];
}): string[] {
  const { views, luck } = input;
  const scored = views.filter(
    (v) => (v.status === 'final' || v.status === 'provisional') && v.home.points !== null && v.away.points !== null,
  );
  if (scored.length === 0) return [];

  const fmt = (n: number) => n.toFixed(2);
  const lines: string[] = [];
  const sides = scored.flatMap((v) => [v.home, v.away]);

  const games = scored
    .map((v) => {
      const [w, l] = v.home.points! >= v.away.points! ? [v.home, v.away] : [v.away, v.home];
      return { w, l, margin: round2(w.points! - l.points!) };
    })
    .sort((a, b) => a.margin - b.margin);

  const byPoints = [...sides].sort((a, b) => b.points! - a.points!);
  lines.push(
    `High score: ${byPoints[0].model} with ${fmt(byPoints[0].points!)}. Low: ${byPoints.at(-1)!.model} with ${fmt(byPoints.at(-1)!.points!)}.`,
  );

  const close = games[0];
  const blowout = games.at(-1)!;
  lines.push(`Closest game: ${close.w.model} over ${close.l.model} by ${fmt(close.margin)}.`);
  if (games.length > 1) {
    lines.push(`Biggest win: ${blowout.w.model} over ${blowout.l.model} by ${fmt(blowout.margin)}.`);
  }

  const starters = sides.flatMap((side) =>
    side.starters.filter((s) => s.player?.points != null).map((s) => ({ side, p: s.player! })),
  );
  const star = starters.sort((a, b) => b.p.points! - a.p.points!)[0];
  if (star) {
    lines.push(`Player of the week: ${star.p.name} (${star.p.position}), ${fmt(star.p.points!)} for ${star.side.model}.`);
  }

  const judged = sides.filter((s) => s.autopilot?.delta != null);
  if (judged.length > 0) {
    const byDelta = [...judged].sort((a, b) => b.autopilot!.delta! - a.autopilot!.delta!);
    const best = byDelta[0];
    const worst = byDelta.at(-1)!;
    const same = judged.filter((s) => s.autopilot!.swaps.length === 0).length;
    if (best.autopilot!.delta! > 0) {
      lines.push(`Best lineup calls: ${best.model}, ${signed(best.autopilot!.delta!)} over the autopilot.`);
    }
    if (worst.autopilot!.delta! < 0) {
      lines.push(`Costliest lineup calls: ${worst.model}, ${signed(worst.autopilot!.delta!)} against the autopilot.`);
    }
    lines.push(`${same} of ${judged.length} teams started exactly what the autopilot would have.`);
    const flipped = games.filter(
      (g) => g.w.autopilot?.points != null && g.l.autopilot?.points != null && g.l.autopilot.points > g.w.autopilot.points,
    );
    if (flipped.length > 0) {
      lines.push(
        `Decided by the calls: ${flipped.map((g) => `${g.w.model} over ${g.l.model}`).join(', ')} — on autopilot, the loser wins.`,
      );
    }
  }

  const withOptimal = sides.filter((s) => s.optimal !== null && s.points !== null);
  if (withOptimal.length > 0) {
    const worst = [...withOptimal].sort((a, b) => b.optimal! - b.points! - (a.optimal! - a.points!))[0];
    if (worst.optimal! - worst.points! > 0) {
      lines.push(`Most left on the bench, in hindsight: ${worst.model}, ${fmt(worst.optimal! - worst.points!)} points.`);
    }
  }

  for (const note of luck) lines.push(`${note.model} ${note.note}.`);

  return lines;
}
