/**
 * The weekly picks call: every competitor picks the winner of every NFL game this week,
 * with a probability. For entertainment — no lines, no odds, no sportsbook.
 *
 * Two deliberate departures from the league's decision calls, both disclosed on
 * /methodology:
 *
 *   1. Models MAY use their own football knowledge. The user-facing question is "what
 *      do these models think of these teams", and a DATA-only rule would reduce it to
 *      "who has the better record", which a spreadsheet can answer. What they get from
 *      us is what their memory cannot have: this season's results, this week's injury
 *      report, and who is projected to start at quarterback. Where the two disagree the
 *      prompt says the data wins, because their memory stops before this season does.
 *   2. These are not `decisions`. A pick moves no roster and spends no budget, so it
 *      lives in `pick_sets` / `game_picks` — published just as completely.
 *
 * Every model gets the SAME block, byte for byte, and nobody sees anyone else's picks.
 * One context hash per week, published on every set, is what makes that checkable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import { stableHash } from '@/lib/util/hash';
import { loadFixtures, loadOutcomes, type FixtureWithKickoff } from './data';
import { teamRecords, type TeamRecord } from './grade';

export const PICKS_PROMPT_VERSION = 'picks-v1';

/** Lab and model names that must never reach a DATA block (hard rule 9). */
const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

/** Positions whose injuries are listed. K and DEF injuries rarely decide a game. */
const INJURY_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
/** Currently this high on the depth chart counts as a starter or first backup. */
const INJURY_DEPTH_MAX = 2;
/**
 * A team's preseason starters: the top N at each position by season-long projection.
 *
 * Needed because the depth chart alone loses exactly the injuries that matter. Sleeper
 * DEMOTES an injured starter: on 23 Sept 2026 Caleb Williams (Doubtful) was CHI's QB3,
 * Jayden Daniels (Doubtful) WAS's QB2 and Jaxson Dart (Doubtful) NYG's QB3. A depth-1
 * filter showed each team's backup as its starter with no hint why — to a model whose
 * memory says Williams starts, that reads as a data error to be overruled.
 */
const PRESEASON_STARTERS: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };

export const PICKS_SYSTEM = `You are picking the winner of every NFL game this week.

This is a public prediction record, for entertainment. There are no betting
lines, point spreads or odds anywhere in this task. You are not picking against
a spread and you are not advising anyone to bet. Pick who WINS the game.

YOU MAY USE YOUR OWN FOOTBALL KNOWLEDGE: coaching, quarterback quality, roster
strength, home field, how these teams are built. But your knowledge stops
before this season started, and the DATA block does not:
- this_season has every result so far this season. Rosters, coaches and form
  may have changed since your training data. Where DATA disagrees with your
  memory, DATA wins.
- injuries is the current injury report for starters and key backups.
- projected_starting_qb is who is projected to start at quarterback THIS week.
If your reasoning relies on a player, check he is not listed as out.

For EVERY game in games, return:
- pick: the team code (one of the two in that game) you expect to win.
- win_prob: your probability that your pick wins, from 0.5 to 1.
  0.5 is a coin flip. 0.75 means your pick wins three times in four. 0.95 is
  close to certain. These are scored all season with a Brier score — a
  confident miss costs far more than a cautious one — and published.
- reason: one sentence, at most 25 words, naming what decided it.

Return only a single JSON object. No preamble, no markdown, no code fences.`;

const OUTPUT_EXAMPLE = {
  headline: 'One sentence: the pick you are most sure of, or the upset you are calling.',
  picks: [{ game_key: 'AWAY@HOME', pick: 'HOME', win_prob: 0.62, reason: 'One sentence, 25 words max.' }],
};

// ---------------------------------------------------------------------------
// The DATA block
// ---------------------------------------------------------------------------

interface InjuryLine {
  name: string;
  position: string;
  status: string;
  body_part: string | null;
  depth_chart_order: number | null;
  preseason_starter: boolean;
}

/** Player ids of each team's preseason starters, from the season-long projections. */
async function loadPreseasonStarters(db: SupabaseClient, season: number, teams: string[]): Promise<Set<string>> {
  const { data, error } = await db
    .from('player_projections')
    .select('player_id, proj_pts, players!inner(position, nfl_team)')
    .eq('season', season)
    .is('week', null)
    .in('players.nfl_team', teams)
    .in('players.position', INJURY_POSITIONS)
    .order('proj_pts', { ascending: false })
    .order('player_id');
  if (error) throw new Error(`season-long projections: ${error.message}`);

  const taken = new Map<string, number>();
  const out = new Set<string>();
  for (const row of data ?? []) {
    const player = row.players as unknown as { position: string; nfl_team: string };
    const slot = `${player.nfl_team}:${player.position}`;
    const count = taken.get(slot) ?? 0;
    if (count >= (PRESEASON_STARTERS[player.position] ?? 0)) continue;
    taken.set(slot, count + 1);
    out.add(row.player_id as string);
  }
  return out;
}

async function loadInjuries(
  db: SupabaseClient,
  season: number,
  teams: string[],
): Promise<Record<string, InjuryLine[]>> {
  const starters = await loadPreseasonStarters(db, season, teams);
  const { data, error } = await db
    .from('players')
    .select('sleeper_id, name, position, nfl_team, injury_status, injury_body_part, depth_chart_order')
    .in('nfl_team', teams)
    .in('position', INJURY_POSITIONS)
    .not('injury_status', 'is', null)
    .order('nfl_team')
    .order('position')
    .order('depth_chart_order', { nullsFirst: false })
    .order('name');
  if (error) throw new Error(`injuries: ${error.message}`);

  const out: Record<string, InjuryLine[]> = {};
  for (const team of [...teams].sort()) out[team] = [];
  for (const row of data ?? []) {
    const depth = (row.depth_chart_order as number | null) ?? null;
    const starter = starters.has(row.sleeper_id as string);
    // Listed if he was a starter going into the season, wherever the depth chart has
    // moved him since, or if he is a starter or first backup now. A backup QB's
    // hamstring does not move a game; a starting QB's does.
    const nowKey = depth !== null && (row.position === 'QB' ? depth <= 1 : depth <= INJURY_DEPTH_MAX);
    if (!starter && !nowKey) continue;
    out[row.nfl_team as string]?.push({
      name: row.name as string,
      position: row.position as string,
      status: row.injury_status as string,
      body_part: (row.injury_body_part as string | null) ?? null,
      depth_chart_order: depth,
      preseason_starter: starter,
    });
  }
  return out;
}

/** The highest-projected QB per team this week — who the projections expect to start. */
async function loadProjectedQbs(
  db: SupabaseClient,
  season: number,
  week: number,
  teams: string[],
): Promise<Record<string, string | null>> {
  const { data, error } = await db
    .from('player_projections')
    .select('proj_pts, raw_projection, players!inner(name, position, nfl_team)')
    .eq('season', season)
    .eq('week', week)
    .eq('players.position', 'QB')
    .order('proj_pts', { ascending: false });
  if (error) throw new Error(`QB projections: ${error.message}`);

  const out: Record<string, string | null> = {};
  for (const team of [...teams].sort()) out[team] = null;
  for (const row of data ?? []) {
    const player = row.players as unknown as { name: string; nfl_team: string | null };
    const raw = (row.raw_projection ?? {}) as Record<string, unknown>;
    const team = (raw._team as string | null) ?? player.nfl_team;
    if (team && team in out && out[team] === null && Number(row.proj_pts ?? 0) > 0) out[team] = player.name;
  }
  return out;
}

function easternDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function recordLine(r: TeamRecord | undefined) {
  if (!r) return { record: '0-0', points_for: 0, points_against: 0, games: [] };
  return {
    record: r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`,
    points_for: r.pointsFor,
    points_against: r.pointsAgainst,
    games: r.games.map((g) => ({
      week: g.week,
      opponent: g.opponent,
      at: g.at,
      score: `${g.scoreFor}-${g.scoreAgainst}`,
      result: g.result,
    })),
  };
}

export interface PicksData {
  week: number;
  fixtures: FixtureWithKickoff[];
  data: Record<string, unknown>;
  contextHash: string;
}

export async function buildPicksData(db: SupabaseClient, season: number, week: number): Promise<PicksData> {
  const fixtures = await loadFixtures(db, season, week);
  if (fixtures.length === 0) throw new Error(`no fixtures stored for ${season} week ${week}`);
  const teams = [...new Set(fixtures.flatMap((f) => [f.away, f.home]))];

  const past = [];
  for (let w = 1; w < week; w++) {
    const { outcomes } = await loadOutcomes(db, season, w);
    past.push({ week: w, outcomes });
  }
  const records = teamRecords(past);

  const data = {
    week,
    games: fixtures.map((f) => ({
      game_key: f.gameKey,
      away: f.away,
      home: f.home,
      // The DATE only. Our stored kickoff time is modelled, not reported, and must not
      // be presented as the real one (see src/lib/sleeper/kickoff.ts).
      // Eastern, not UTC: a Thursday night game is already Friday in UTC.
      date: f.kickoffAt ? easternDate(f.kickoffAt) : null,
    })),
    this_season: Object.fromEntries([...teams].sort().map((t) => [t, recordLine(records.get(t))])),
    injuries: await loadInjuries(db, season, teams),
    projected_starting_qb: await loadProjectedQbs(db, season, week, teams),
    data_notes: [
      'Scores in this_season are final NFL scores, most recent week last.',
      'injuries lists QB/RB/WR/TE on the injury report who were preseason starters (preseason_starter: true) or are first or second on the depth chart now (starting QB only). Teams move an injured starter down the depth chart, so a preseason starter with a high depth_chart_order is usually hurt, not benched.',
      'projected_starting_qb is the highest-projected quarterback for that team this week; null if none is projected.',
      'There are no betting lines, spreads, odds or weather in this data set.',
    ],
  };

  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);
  return { week, fixtures, data, contextHash: stableHash(data) };
}

// ---------------------------------------------------------------------------
// The response schema — built per week, because the game keys are the outcome
// ---------------------------------------------------------------------------

/**
 * Strict on outcomes (every game picked exactly once, a pick that is one of the two
 * teams, a probability in range) and nothing else. A schema failure goes back to the
 * model through `callModel`'s parse retries, exactly as a malformed lineup does.
 */
export function picksSchema(fixtures: FixtureWithKickoff[]) {
  const keys = fixtures.map((f) => f.gameKey) as [string, ...string[]];
  const sides = new Map(fixtures.map((f) => [f.gameKey, [f.away, f.home]]));

  return z
    .object({
      headline: z.string().min(1),
      picks: z.array(
        z.object({
          game_key: z.enum(keys),
          pick: z.string().min(1),
          win_prob: z.number().min(0.5).max(1),
          reason: z.string().min(1),
        }),
      ),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      for (const p of value.picks) {
        if (seen.has(p.game_key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.game_key} picked twice` });
        }
        seen.add(p.game_key);
        if (!sides.get(p.game_key)?.includes(p.pick)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${p.game_key}: pick "${p.pick}" is not one of ${sides.get(p.game_key)?.join(' / ')}`,
          });
        }
      }
      const missing = keys.filter((k) => !seen.has(k));
      if (missing.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `no pick for ${missing.join(', ')}` });
      }
    });
}

export type PicksResponse = z.infer<ReturnType<typeof picksSchema>>;

export function picksUserPrompt(input: PicksData): string {
  return [
    '=== DATA ===',
    JSON.stringify(input.data),
    '=== END DATA ===',
    '',
    `Pick the winner of all ${input.fixtures.length} games in week ${input.week}. Every game_key in games, exactly once.`,
    '',
    'Return exactly this JSON shape and nothing else (one entry in picks per game):',
    JSON.stringify(OUTPUT_EXAMPLE, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Calling and storing
// ---------------------------------------------------------------------------

export interface PickEntrant {
  key: string;
  displayName: string;
  openrouterId: string;
  modelId: string;
}

export interface PickSetOutcome {
  entrant: PickEntrant;
  valid: boolean;
  providerFailure: boolean;
  error: string | null;
  costUsd: number;
  headline: string | null;
}

/**
 * One model's picks, stored the moment they land.
 *
 * Stored here rather than by the caller after all eight settle, because a Vercel
 * function killed at its ceiling flushes nothing: the unit of loss on a timeout should
 * be the models still thinking, not the ones that already answered.
 */
export async function decideAndStore(
  db: SupabaseClient,
  seasonId: string,
  input: PicksData,
  entrant: PickEntrant,
): Promise<PickSetOutcome> {
  const userPrompt = picksUserPrompt(input);
  const call = await callModel({
    openrouterId: entrant.openrouterId,
    systemPrompt: PICKS_SYSTEM,
    userPrompt,
    schema: picksSchema(input.fixtures),
    maxOutputTokens: LEAGUE.maxOutputTokens,
  });

  const { data: set, error } = await db
    .from('pick_sets')
    .upsert(
      {
        season_id: seasonId,
        week: input.week,
        model_id: entrant.modelId,
        prompt_version: PICKS_PROMPT_VERSION,
        system_prompt: PICKS_SYSTEM,
        user_prompt: userPrompt,
        context_hash: input.contextHash,
        raw_response: call.rawResponse,
        headline: call.parsed?.headline ?? null,
        valid: call.ok,
        validation_error: call.validationError,
        provider_failure: call.providerFailure,
        retry_count: call.retryCount,
        latency_ms: call.latencyMs,
        cost_usd: call.usage.costUsd,
        locked_at: new Date().toISOString(),
      },
      { onConflict: 'season_id,week,model_id' },
    )
    .select('id')
    .single();
  if (error) throw new Error(`pick_sets (${entrant.displayName}): ${error.message}`);

  if (call.parsed) {
    const { error: pickError } = await db.from('game_picks').upsert(
      call.parsed.picks.map((p) => ({
        pick_set_id: set.id,
        season_id: seasonId,
        week: input.week,
        model_id: entrant.modelId,
        game_key: p.game_key,
        pick: p.pick,
        win_prob: p.win_prob,
        reason: p.reason,
      })),
      { onConflict: 'season_id,week,model_id,game_key' },
    );
    if (pickError) throw new Error(`game_picks (${entrant.displayName}): ${pickError.message}`);
  }

  return {
    entrant,
    valid: call.ok,
    providerFailure: call.providerFailure,
    error: call.validationError,
    costUsd: call.usage.costUsd ?? 0,
    headline: call.parsed?.headline ?? null,
  };
}
