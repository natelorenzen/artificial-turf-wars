/**
 * The shared pre-season dossier (SPEC §4.1b Step 1).
 *
 * One large data pack, built once, hashed, and sent byte-identically to all eight
 * models. This is the league's answer to "research": no model gets web search,
 * because eight models searching independently would return different results at
 * different times and destroy both fairness and reproducibility. Everyone gets the
 * same, deeper corpus instead.
 *
 * WHY THE SCARCITY CURVES MATTER — learned from the 2025 backtest draft, which ran
 * without a dossier. Given only raw `proj_season_points`, five of the first eight
 * picks were quarterbacks, in a league that starts ONE. The models were not being
 * careless; they were being literal, and one of them said so outright: "Ja'Marr Chase
 * leads non-QBs at 328.3 and adp 1 yet trails both QBs."
 *
 * Raw projection without a replacement baseline is a misleading number. §4.1b already
 * required these curves; the backtest turned that from a nice-to-have into a
 * precondition for the draft being about reasoning rather than about our data gap.
 *
 * What we deliberately do NOT ship: a precomputed value-over-replacement ranking.
 * The curve and the baseline are facts; turning them into a draft order is the
 * reasoning we are trying to observe. Which models do that arithmetic themselves is
 * one of the more interesting things this season can reveal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FLEX_ELIGIBLE, LEAGUE, SLOTS, type Position } from '@/lib/config/league';
import { estimateTokens } from '@/lib/prompt/assemble';
import { stableHash, stableStringify } from '@/lib/util/hash';

export interface DossierPlayer {
  player_id: string;
  name: string;
  position: Position;
  nfl_team: string | null;
  proj_season_points: number;
  last_season_points: number | null;
  adp: number | null;
  positional_rank: number;
  bye_week: number | null;
  depth_chart_order: number | null;
  injury_status: string | null;
}

export interface ScarcityCurve {
  position: Position;
  /** Projected points at selected positional ranks — where the cliffs are. */
  points_by_rank: { rank: number; proj_season_points: number }[];
  /**
   * The last player at this position expected to start in an 8-team league, and what
   * he projects. Anything above this is the margin the position actually buys you.
   */
  replacement_rank: number;
  replacement_points: number;
  /** Points between the best player at the position and replacement level. */
  spread_over_replacement: number;
}

export interface Dossier {
  season: number;
  league: {
    teams: number;
    roster_size: number;
    starters: Record<string, number>;
    flex_eligible: string[];
    rounds: number;
    budget_total: number;
  };
  scarcity_curves: ScarcityCurve[];
  players: DossierPlayer[];
  byes_by_team: Record<string, number>;
  notes: string[];
}

/**
 * Starters league-wide at each position, which is where replacement level sits.
 * FLEX is shared across RB/WR/TE, so it is distributed rather than assigned.
 */
export function replacementRank(position: Position, teams = LEAGUE.teams): number {
  const dedicated = (SLOTS[position as keyof typeof SLOTS] ?? 0) * teams;
  if (!FLEX_ELIGIBLE.includes(position)) return Math.max(1, dedicated);
  // The flex is most often an RB or WR; split it across the eligible positions.
  const flexShare = Math.round((SLOTS.FLEX * teams) / FLEX_ELIGIBLE.length);
  return Math.max(1, dedicated + flexShare);
}

function buildCurve(position: Position, ranked: DossierPlayer[]): ScarcityCurve {
  const replacement = replacementRank(position);
  const at = (rank: number) => ranked[rank - 1]?.proj_season_points ?? 0;

  // Sample densely where the cliffs are and sparsely in the tail.
  const marks = [...new Set([1, 2, 3, 5, 8, 10, 12, 16, 20, 24, 30, 36, replacement])]
    .filter((r) => r <= ranked.length)
    .sort((a, b) => a - b);

  return {
    position,
    points_by_rank: marks.map((rank) => ({ rank, proj_season_points: at(rank) })),
    replacement_rank: replacement,
    replacement_points: at(replacement),
    spread_over_replacement: Number((at(1) - at(replacement)).toFixed(1)),
  };
}

export interface BuildDossierOptions {
  season: number;
  /** Players per position. The default keeps the pack well inside the token ceiling. */
  perPosition?: number;
}

export async function buildDossier(
  db: SupabaseClient,
  options: BuildDossierOptions,
): Promise<{ dossier: Dossier; hash: string; tokenCount: number }> {
  const { season, perPosition = 60 } = options;

  const { data: byeRows } = await db.from('team_byes').select('nfl_team, week').eq('season', season);
  const byes: Record<string, number> = {};
  for (const row of byeRows ?? []) byes[row.nfl_team as string] = row.week as number;

  // Prior-season actual points, summed from our own scored stats.
  const prior = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('player_stats')
      .select('player_id, computed_pts')
      .eq('season', season - 1)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      prior.set(row.player_id as string, (prior.get(row.player_id as string) ?? 0) + Number(row.computed_pts));
    }
    if (data.length < 1000) break;
  }

  const players: DossierPlayer[] = [];
  const curves: ScarcityCurve[] = [];

  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as Position[]) {
    const { data, error } = await db
      .from('player_projections')
      .select('player_id, proj_pts, adp, players!inner(name, position, nfl_team, depth_chart_order, injury_status)')
      .eq('season', season)
      // Season-long rows only — the weekend guide writes per-WEEK rows to this table,
      // and without this the dossier would list every player once per ingested week.
      .is('week', null)
      .eq('players.position', position)
      .order('proj_pts', { ascending: false })
      .limit(perPosition);
    if (error) throw new Error(`dossier ${position}: ${error.message}`);

    const ranked = (data ?? []).map((row, index) => {
      const p = row.players as unknown as {
        name: string;
        nfl_team: string | null;
        depth_chart_order: number | null;
        injury_status: string | null;
      };
      const priorPoints = prior.get(row.player_id as string);
      return {
        player_id: row.player_id as string,
        name: p.name,
        position,
        nfl_team: p.nfl_team,
        proj_season_points: Number(row.proj_pts),
        last_season_points: priorPoints === undefined ? null : Number(priorPoints.toFixed(1)),
        adp: row.adp === null ? null : Number(row.adp),
        positional_rank: index + 1,
        bye_week: p.nfl_team ? (byes[p.nfl_team] ?? null) : null,
        depth_chart_order: p.depth_chart_order,
        injury_status: p.injury_status,
      } satisfies DossierPlayer;
    });

    players.push(...ranked);
    curves.push(buildCurve(position, ranked));
  }

  const dossier: Dossier = {
    season,
    league: {
      teams: LEAGUE.teams,
      roster_size: LEAGUE.rosterSize,
      starters: SLOTS,
      flex_eligible: FLEX_ELIGIBLE,
      rounds: LEAGUE.draftRounds,
      budget_total: LEAGUE.budgetTotal,
    },
    scarcity_curves: curves,
    players,
    byes_by_team: byes,
    notes: [
      'proj_season_points is computed under THIS league\'s scoring rules, not a generic format.',
      'scarcity_curves show projected points by positional rank, and the replacement_rank is the last player at that position expected to start anywhere in an 8-team league.',
      'A position\'s raw projection and its value over replacement are different numbers. Both are derivable from what is here.',
      'adp is null for kickers and defenses — no ADP is published for them.',
      'last_season_points is scored under this league\'s rules from actual results, and is null for players with no prior-season data.',
    ],
  };

  const serialized = stableStringify(dossier);
  const tokenCount = estimateTokens(serialized);

  // SPEC §4.1b: measure it, assert it, log it. An unbounded dossier is the most
  // likely way to breach the §8.1 context ceiling.
  if (tokenCount > LEAGUE.dossierMaxTokens) {
    throw new Error(
      `dossier is ~${tokenCount} tokens, over the ${LEAGUE.dossierMaxTokens} ceiling. ` +
        'Reduce perPosition rather than raising the ceiling.',
    );
  }

  return { dossier, hash: stableHash(dossier), tokenCount };
}
