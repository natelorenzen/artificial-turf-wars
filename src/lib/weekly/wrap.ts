/**
 * The weekly wrap (SPEC §7.5).
 *
 * Written by `BEAT_WRITER_MODEL`, which has no team in the league. That is not a
 * stylistic choice: a competitor narrating the standings it is in would be reporting on
 * its own week, and every sentence about a rival would be suspect. The beat writer has
 * nothing to gain from any of it.
 *
 * Two rules make the article checkable rather than merely readable:
 *
 *   1. The FACTS PACKET is assembled deterministically from our own tables and hashed.
 *      The writer sees nothing else. Every figure it could legitimately use is in
 *      there, so anything it prints that is not in there was invented.
 *   2. The NUMBER CHECK is a deterministic post-pass over what came back. It never
 *      calls a model, it never repairs the prose, and a failure is stored and published
 *      rather than retried away — because "the beat writer got a score wrong" is a
 *      finding about these models, which is the actual product.
 *
 * Where head-to-head and all-play disagree, the packet says so explicitly. The site
 * leads with that disagreement (SPEC §14.2) and an article that smoothed it over would
 * be describing a different league from the one the tables show.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BEAT_WRITER_MODEL, LEAGUE } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { collectDataIndex } from '@/lib/prompt/cited';
import { round2 } from '@/lib/scoring/engine';
import { allPlayWeek } from '@/lib/engine/allplay';
import { buildLabelMap } from '@/lib/engine/labels';
import { stableHash } from '@/lib/util/hash';
import { recapSchema, type RecapResponse } from '@/lib/schemas/decisions';

const RECAP_OUTPUT_EXAMPLE = {
  headline: 'One line, under twelve words.',
  short_post: 'Two or three sentences that stand alone as a social post.',
  column_md: '## Markdown column\n\nSeveral hundred words.',
};

const WRITER_SYSTEM = `You are the beat writer for a fantasy football league contested by
eight AI models. You do not have a team in it and you are not one of the competitors.

You are given a FACTS packet for one completed week: every team's score, the
head-to-head results, the all-play records, lineup efficiency, and what each model said
when it set the lineup. Write the week's column.

RULES:
1. Use only the figures in the FACTS packet. Every number you print must appear there.
   Invent no statistic, no injury and no transaction. If you want a figure that is not
   in the packet, write the sentence without it.
2. Refer to the teams by the model display names given. The anonymous labels are how
   the models see each other; your readers see the models.
3. Where head_to_head and all_play disagree about who had a good week, that IS the
   story. Name it. Do not smooth it into a single narrative.
4. Quote a model's own headline when it is worth quoting, attributed. You are reporting
   on their reasoning, not replacing it with yours.
5. A lineup marked fallback_applied was set by the league's deterministic code because
   the model's answer was unusable. Say so plainly when it mattered; do not describe it
   as a decision the model made.
6. No predictions about future weeks beyond what the standings support.

Return only a single JSON object matching the schema. No preamble, no code fences.`;

// ---------------------------------------------------------------------------
// The facts packet
// ---------------------------------------------------------------------------

export interface WrapTeamFacts {
  label: string;
  model: string;
  points: number;
  optimal_points: number;
  lineup_efficiency: number;
  points_left_on_bench: number;
  empty_slots: number;
  fallback_applied: boolean;
  opponent: string | null;
  opponent_points: number | null;
  result: 'W' | 'L' | 'T' | null;
  allplay_week: string;
  record: string;
  rank: number | null;
  points_for: number;
  /** What the model said on Thursday when it set this lineup. */
  lineup_headline: string | null;
  lineup_closest_call: string | null;
}

export interface WrapFacts {
  season: number;
  week: number;
  scoring_status: string;
  ranking_basis: string;
  teams: WrapTeamFacts[];
  high_score: { model: string; points: number } | null;
  low_score: { model: string; points: number } | null;
  closest_matchup: { winner: string; loser: string; margin: number } | null;
  biggest_margin: { winner: string; loser: string; margin: number } | null;
  best_efficiency: { model: string; efficiency: number } | null;
  worst_efficiency: { model: string; efficiency: number } | null;
  /**
   * The weeks where the schedule and the scoreboard disagree. A team that outscored
   * five of seven rivals and still lost is the single most interesting row in any
   * week, and it is invisible in a head-to-head table alone.
   */
  luck: { model: string; note: string }[];
  waiver_adds: { model: string; player: string; bid: number; points_this_week: number | null }[];
}

export async function buildWrapFacts(
  db: SupabaseClient,
  input: { seasonId: string; season: number; week: number },
): Promise<WrapFacts> {
  const { seasonId, season, week } = input;

  const { data: teamRows, error: teamError } = await db
    .from('teams')
    .select('id, draft_slot, models!inner(display_name)')
    .eq('season_id', seasonId);
  if (teamError) throw new Error(`teams: ${teamError.message}`);

  const teams = (teamRows ?? []) as unknown as {
    id: string;
    draft_slot: number | null;
    models: { display_name: string };
  }[];
  const labels = buildLabelMap(
    teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot ?? 0 })),
  );
  const nameOf = new Map(teams.map((t) => [t.id, t.models.display_name]));

  const scores = await loadWeekScores(db, teams.map((t) => t.id), week);
  const lineupMeta = await loadLineupMeta(db, teams.map((t) => t.id), week);
  const standings = await loadStandingsRow(db, teams.map((t) => t.id), week);
  const matchups = await loadMatchups(db, seasonId, week);

  const scored = teams.filter((t) => scores.has(t.id));
  const perWeekAllPlay = allPlayWeek(
    scored.map((t) => ({ teamId: t.id, points: scores.get(t.id)!.total })),
  );
  const allPlayOf = new Map(perWeekAllPlay.map((r) => [r.teamId, r]));

  const opponentOf = new Map<string, string>();
  for (const m of matchups) {
    opponentOf.set(m.homeTeamId, m.awayTeamId);
    opponentOf.set(m.awayTeamId, m.homeTeamId);
  }

  const facts: WrapTeamFacts[] = scored.map((team) => {
    const score = scores.get(team.id)!;
    const opponentId = opponentOf.get(team.id) ?? null;
    const opponentPoints = opponentId ? (scores.get(opponentId)?.total ?? null) : null;
    const allplay = allPlayOf.get(team.id);
    const standing = standings.get(team.id);
    const meta = lineupMeta.get(team.id);

    return {
      label: labels.get(team.id)!,
      model: nameOf.get(team.id)!,
      points: score.total,
      optimal_points: score.optimal,
      lineup_efficiency: score.efficiency,
      points_left_on_bench: round2(score.optimal - score.total),
      empty_slots: score.emptySlots,
      fallback_applied: meta?.fallbackApplied ?? false,
      opponent: opponentId ? nameOf.get(opponentId)! : null,
      opponent_points: opponentPoints,
      result:
        opponentPoints === null
          ? null
          : score.total > opponentPoints
            ? 'W'
            : score.total < opponentPoints
              ? 'L'
              : 'T',
      allplay_week: allplay ? `${allplay.wins}-${allplay.losses}` : '0-0',
      record: standing ? `${standing.h2hW}-${standing.h2hL}${standing.h2hT > 0 ? `-${standing.h2hT}` : ''}` : '0-0',
      rank: standing?.rank ?? null,
      points_for: standing?.cumPts ?? score.total,
      lineup_headline: meta?.headline ?? null,
      lineup_closest_call: meta?.closestCall ?? null,
    };
  });

  const byPoints = [...facts].sort((a, b) => b.points - a.points);
  const byEfficiency = [...facts].sort((a, b) => b.lineup_efficiency - a.lineup_efficiency);
  const margins = matchups
    .map((m) => {
      const home = facts.find((f) => f.label === labels.get(m.homeTeamId));
      const away = facts.find((f) => f.label === labels.get(m.awayTeamId));
      if (!home || !away) return null;
      const [winner, loser] = home.points >= away.points ? [home, away] : [away, home];
      return { winner: winner.model, loser: loser.model, margin: round2(winner.points - loser.points) };
    })
    .filter((m): m is { winner: string; loser: string; margin: number } => m !== null)
    .sort((a, b) => a.margin - b.margin);

  return {
    season,
    week,
    scoring_status: [...scores.values()][0]?.status ?? 'provisional',
    ranking_basis: 'head-to-head',
    teams: facts.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    high_score: byPoints[0] ? { model: byPoints[0].model, points: byPoints[0].points } : null,
    low_score: byPoints.at(-1)
      ? { model: byPoints.at(-1)!.model, points: byPoints.at(-1)!.points }
      : null,
    closest_matchup: margins[0] ?? null,
    biggest_margin: margins.at(-1) ?? null,
    best_efficiency: byEfficiency[0]
      ? { model: byEfficiency[0].model, efficiency: byEfficiency[0].lineup_efficiency }
      : null,
    worst_efficiency: byEfficiency.at(-1)
      ? { model: byEfficiency.at(-1)!.model, efficiency: byEfficiency.at(-1)!.lineup_efficiency }
      : null,
    luck: unluckyAndLucky(facts),
    waiver_adds: await loadWaiverAdds(db, teams.map((t) => t.id), week, nameOf),
  };
}

/**
 * Who the schedule treated unfairly this week.
 *
 * "Top-half score, lost anyway" and "bottom-half score, won anyway" are the two rows
 * that make head-to-head worth ranking on and all-play worth publishing. Computed here
 * rather than left for the writer to notice, because a model asked to spot it would
 * sometimes not, and the finding would silently vary by week.
 */
export function unluckyAndLucky(facts: WrapTeamFacts[]): { model: string; note: string }[] {
  const half = (facts.length - 1) / 2;
  const out: { model: string; note: string }[] = [];

  for (const team of facts) {
    const wins = Number(team.allplay_week.split('-')[0]);
    if (team.result === 'L' && wins > half) {
      out.push({
        model: team.model,
        note: `scored ${team.points}, beat ${team.allplay_week.split('-')[0]} of ${facts.length - 1} rivals on all-play, and still lost to ${team.opponent}`,
      });
    }
    if (team.result === 'W' && wins < half) {
      out.push({
        model: team.model,
        note: `won with ${team.points}, which would have lost to ${facts.length - 1 - wins} of ${facts.length - 1} rivals`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The number check
// ---------------------------------------------------------------------------

/** Below this, a number in prose is almost always English ("all 8 teams"), not a claim. */
const NUMERIC_CLAIM_FLOOR = 10;

export interface NumberCheck {
  passed: boolean;
  notes: string[];
}

const numberKey = (value: number) => String(Number(value.toFixed(4)));

/**
 * Every number the article is allowed to print.
 *
 * `collectDataIndex` alone is not enough, and the first real article proved it by
 * failing ten times for three reasons, none of them the writer's fault:
 *
 *   1. **Figures quoted out of the packet's own prose.** The packet carries each
 *      model's `lineup_closest_call` verbatim, and those sentences contain numbers —
 *      "Pollard's last3_ppg 11.23 and season_ppg 10.4". Quoting a model accurately is
 *      the thing the writer is told to do in rule 4, and the index only held numbers
 *      that appeared as JSON numbers, so every accurate quotation was an accusation.
 *   2. **Percentages.** An efficiency of 1.0 written as "100%" is the same claim.
 *      Only values in [0,1] get this, so it cannot launder an invented score.
 */
function allowedNumbers(facts: WrapFacts): Set<string> {
  const index = collectDataIndex(facts);
  const allowed = new Set(index.numbers);

  for (const text of index.strings) {
    for (const raw of text.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      const value = Number(raw);
      if (Number.isFinite(value)) allowed.add(numberKey(value));
    }
  }

  for (const key of [...allowed]) {
    const value = Number(key);
    if (value >= 0 && value <= 1) allowed.add(numberKey(value * 100));
  }

  //   3. **Rounding.** A writer that says two models "topped 0.85 efficiency" when the
  //      packet holds 0.8532 and 0.9202 has said something true, less precisely. The
  //      real week-6 article did exactly that and it was the only flag left standing.
  //      Every value is therefore also allowed at coarser precision. This cannot launder
  //      an invented figure — a number nothing rounds to is still caught — it only stops
  //      the check demanding four decimal places in English prose.
  for (const key of [...allowed]) {
    const value = Number(key);
    for (const places of [0, 1, 2, 3]) allowed.add(numberKey(Number(value.toFixed(places))));
  }

  return allowed;
}

/**
 * Every figure in the article must appear in the facts packet.
 *
 * Deterministic and unforgiving on purpose: this is the mechanism that lets the site
 * say a wrap is checked rather than merely proofread. It does not repair anything —
 * a rewrite loop would hide exactly the behaviour worth publishing.
 *
 * Which makes a FALSE positive the expensive failure, not a missed one. This check
 * publishes an accusation against a named model, so every leniency below exists
 * because the alternative was printing something untrue about the writer.
 */
export function numberCheck(article: RecapResponse, facts: WrapFacts): NumberCheck {
  const allowed = allowedNumbers(facts);

  // Model display names carry version numbers — "Grok 4.5", "Muse Spark 1.1",
  // "GPT-5.6 Sol" — and rule 2 REQUIRES the writer to use them. Left in, the scan reads
  // "4.5" as an invented statistic and the hyphen in "GPT-5.6" as a negative number.
  // Stripping the name string still leaves any genuine later use of the same figure.
  let prose = [article.headline, article.short_post, article.column_md].join('\n');
  for (const model of facts.teams.map((t) => t.model).sort((a, b) => b.length - a.length)) {
    prose = prose.split(model).join(' ');
  }

  const notes: string[] = [];
  const seen = new Set<string>();

  for (const raw of prose.match(/-?\d+(?:\.\d+)?/g) ?? []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    // Whole numbers below the floor are prose; decimals are always claims.
    if (Number.isInteger(value) && Math.abs(value) < NUMERIC_CLAIM_FLOOR) continue;
    // The week number is in the packet, but "week 7" reads as prose either way.
    if (value === facts.week || value === facts.season) continue;

    const key = numberKey(value);
    if (allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    notes.push(`${raw} does not appear in the facts packet`);
  }

  return { passed: notes.length === 0, notes };
}

// ---------------------------------------------------------------------------
// The result check
// ---------------------------------------------------------------------------

/**
 * Verbs that assert a direction, and which way round they point.
 *
 * `true` means the model named FIRST won.
 */
const RESULT_VERBS: [RegExp, boolean][] = [
  [/\b(?:beat|beats|defeated|topped|downed|outscored|held off|edged|dispatched)\b/i, true],
  [/\b(?:win|victory|drubbing|demolition|dismantling|rout)\s+(?:of|over)\b/i, true],
  [/\b(?:lost to|fell to|fell short against|was beaten by|succumbed to|went down to)\b/i, false],
];

/**
 * Catch an article that gets a result backwards.
 *
 * The number check cannot: the very first real wrap said DeepSeek V4 Pro "fell to
 * GPT-5.6 Sol, 139.14 to 122.92" when DeepSeek had in fact WON with that 139.14, and
 * every figure in the sentence was straight out of the packet. Both numbers checked
 * out; only the relationship between them was false. An article whose headline is built
 * on an inverted result is worse than one with a wrong decimal in it, and until this
 * existed nothing would have caught it.
 *
 * Deliberately conservative, in the same direction as everything else here:
 *
 *   - only sentences naming exactly TWO models are considered, because "beat everyone
 *     except Kimi K3" is a shape this cannot parse and must not guess at;
 *   - only pairs that ACTUALLY PLAYED each other are judged. Two models can both have
 *     won without meeting, and flagging a comparison between them would be inventing a
 *     fixture to be wrong about.
 *
 * So it under-reports by construction. A missed inversion is a bad week; a fabricated
 * accusation against a named lab is a different kind of problem.
 */
export function resultCheck(article: RecapResponse, facts: WrapFacts): NumberCheck {
  const winnerOver = new Map<string, string>();
  for (const team of facts.teams) {
    if (team.result === 'W' && team.opponent) winnerOver.set(team.model, team.opponent);
  }
  if (winnerOver.size === 0) return { passed: true, notes: [] };

  const models = facts.teams.map((t) => t.model).sort((a, b) => b.length - a.length);
  const prose = [article.headline, article.short_post, article.column_md].join('\n');
  const notes: string[] = [];

  for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
    const found = models
      .map((model) => ({ model, at: sentence.indexOf(model) }))
      .filter((hit) => hit.at >= 0)
      .sort((a, b) => a.at - b.at);
    if (found.length !== 2) continue;

    const [first, second] = found;
    const between = sentence.slice(first.at + first.model.length, second.at);

    for (const [verb, firstWon] of RESULT_VERBS) {
      if (!verb.test(between)) continue;

      const claimedWinner = firstWon ? first.model : second.model;
      const claimedLoser = firstWon ? second.model : first.model;

      // Only judge a pair that met. Anything else is not a claim about a fixture.
      const played =
        winnerOver.get(claimedWinner) === claimedLoser ||
        winnerOver.get(claimedLoser) === claimedWinner;
      if (!played) break;

      if (winnerOver.get(claimedWinner) !== claimedLoser) {
        notes.push(
          `says ${claimedWinner} beat ${claimedLoser}, but ${claimedLoser} won that matchup`,
        );
      }
      break;
    }
  }

  return { passed: notes.length === 0, notes };
}

/**
 * Both deterministic passes, merged.
 *
 * They share `recaps.number_check_*` rather than getting a column each: what the site
 * needs to say is "this article was checked and here is what did not check out", and
 * splitting that across two flags invites publishing one of them.
 *
 * A wrong RESULT is listed before a wrong figure, because it is the worse error — a
 * reader forgives a decimal and does not forgive being told the winner lost.
 */
export function checkArticle(article: RecapResponse, facts: WrapFacts): NumberCheck {
  const results = resultCheck(article, facts);
  const numbers = numberCheck(article, facts);
  return {
    passed: results.passed && numbers.passed,
    notes: [...results.notes.map((n) => `RESULT: ${n}`), ...numbers.notes.map((n) => `FIGURE: ${n}`)],
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface RecapResult {
  recap: RecapResponse | null;
  raw: string | null;
  valid: boolean;
  systemPrompt: string;
  userPrompt: string;
  factsPacket: WrapFacts;
  factsPacketHash: string;
  numbers: NumberCheck;
  costUsd: number;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  validationError: string | null;
  providerFailure: boolean;
  retryCount: number;
}

export async function writeRecap(facts: WrapFacts): Promise<RecapResult> {
  const userPrompt = [
    '=== FACTS ===',
    JSON.stringify(facts, null, 2),
    '=== END FACTS ===',
    '',
    `Write the week ${facts.week} column.`,
    '',
    'Return exactly this JSON shape and nothing else:',
    JSON.stringify(RECAP_OUTPUT_EXAMPLE, null, 2),
  ].join('\n');

  const call = await callModel({
    openrouterId: BEAT_WRITER_MODEL,
    systemPrompt: WRITER_SYSTEM,
    userPrompt,
    schema: recapSchema,
    maxOutputTokens: LEAGUE.maxOutputTokens,
    // The beat writer is intermittently unparseable on the same input — see the note
    // on `writeGuide`. This is the only call in the job, so a parse failure loses the
    // whole week's column for want of one retry.
    parseRetries: 5,
  });

  return {
    recap: call.parsed,
    raw: call.rawResponse,
    valid: call.ok,
    systemPrompt: WRITER_SYSTEM,
    userPrompt,
    factsPacket: facts,
    factsPacketHash: stableHash(facts),
    numbers: call.parsed ? checkArticle(call.parsed, facts) : { passed: false, notes: ['no article'] },
    costUsd: call.usage.costUsd ?? 0,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
    latencyMs: call.latencyMs,
    validationError: call.validationError,
    providerFailure: call.providerFailure,
    retryCount: call.retryCount,
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

interface WeekScore {
  total: number;
  optimal: number;
  efficiency: number;
  emptySlots: number;
  status: string;
}

/** Final beats provisional, exactly as the standings do. */
async function loadWeekScores(
  db: SupabaseClient,
  teamIds: string[],
  week: number,
): Promise<Map<string, WeekScore>> {
  const { data, error } = await db
    .from('lineup_scores')
    .select('week, status, total_pts, optimal_pts, efficiency, per_slot, lineups!inner(team_id)')
    .eq('week', week)
    .in('lineups.team_id', teamIds);
  if (error) throw new Error(`lineup_scores: ${error.message}`);

  const out = new Map<string, WeekScore>();
  for (const row of data ?? []) {
    const teamId = (row.lineups as unknown as { team_id: string }).team_id;
    if (out.get(teamId)?.status === 'final' && row.status !== 'final') continue;
    const perSlot = (row.per_slot ?? []) as { empty?: boolean }[];
    out.set(teamId, {
      total: round2(Number(row.total_pts)),
      optimal: round2(Number(row.optimal_pts)),
      efficiency: Number(Number(row.efficiency).toFixed(4)),
      emptySlots: perSlot.filter((s) => s.empty).length,
      status: row.status as string,
    });
  }
  return out;
}

interface LineupMeta {
  fallbackApplied: boolean;
  headline: string | null;
  closestCall: string | null;
}

/**
 * How the lineup came to be, from the decision behind it.
 *
 * A row with no `decision_id` was never chosen by anybody — the job did not reach that
 * team and the seeded deterministic lineup stood. That is a fallback in every sense
 * that matters to a reader, and reporting it as a model's decision would be a lie of
 * omission.
 */
async function loadLineupMeta(
  db: SupabaseClient,
  teamIds: string[],
  week: number,
): Promise<Map<string, LineupMeta>> {
  const { data, error } = await db
    .from('lineups')
    .select('team_id, decision_id, carried_forward, decisions(headline, closest_call, fallback_applied, provider_failure)')
    .eq('week', week)
    .in('team_id', teamIds);
  if (error) throw new Error(`lineups: ${error.message}`);

  const out = new Map<string, LineupMeta>();
  for (const row of data ?? []) {
    const decision = row.decisions as unknown as {
      headline: string | null;
      closest_call: string | null;
      fallback_applied: boolean;
      provider_failure: boolean;
    } | null;

    out.set(row.team_id as string, {
      fallbackApplied:
        !row.decision_id ||
        Boolean(row.carried_forward) ||
        Boolean(decision?.fallback_applied) ||
        Boolean(decision?.provider_failure),
      headline: decision?.headline ?? null,
      closestCall: decision?.closest_call ?? null,
    });
  }
  return out;
}

async function loadStandingsRow(
  db: SupabaseClient,
  teamIds: string[],
  week: number,
): Promise<Map<string, { h2hW: number; h2hL: number; h2hT: number; cumPts: number; rank: number | null }>> {
  const { data, error } = await db
    .from('standings')
    .select('team_id, h2h_w, h2h_l, h2h_t, cum_pts, rank')
    .eq('week', week)
    .in('team_id', teamIds);
  if (error) throw new Error(`standings: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.team_id as string,
      {
        h2hW: Number(row.h2h_w ?? 0),
        h2hL: Number(row.h2h_l ?? 0),
        h2hT: Number(row.h2h_t ?? 0),
        cumPts: round2(Number(row.cum_pts ?? 0)),
        rank: row.rank === null ? null : Number(row.rank),
      },
    ]),
  );
}

async function loadMatchups(
  db: SupabaseClient,
  seasonId: string,
  week: number,
): Promise<{ homeTeamId: string; awayTeamId: string }[]> {
  const { data, error } = await db
    .from('h2h_schedule')
    .select('home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .eq('week', week);
  if (error) throw new Error(`h2h_schedule: ${error.message}`);
  return (data ?? []).map((row) => ({
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
  }));
}

/**
 * Claims won last week, which are the players that played THIS week.
 *
 * `points_this_week` is left null rather than zeroed when a player has no stat line:
 * the difference between "we bought him and he did nothing" and "we have not scored
 * him yet" is the whole point of a waiver ROI figure.
 */
async function loadWaiverAdds(
  db: SupabaseClient,
  teamIds: string[],
  week: number,
  nameOf: Map<string, string>,
): Promise<{ model: string; player: string; bid: number; points_this_week: number | null }[]> {
  const { data, error } = await db
    .from('waiver_bids')
    .select('team_id, bid, add_player_id, players!waiver_bids_add_player_id_fkey(name)')
    .eq('week', week - 1)
    .eq('won', true)
    .in('team_id', teamIds);
  if (error) {
    // A season with no waiver run yet is not an error worth failing the column over.
    if (/does not exist|could not (find|identify)/i.test(error.message)) return [];
    throw new Error(`waiver_bids: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: statRows } = await db
    .from('player_stats')
    .select('player_id, computed_pts, status')
    .eq('week', week)
    .in('player_id', rows.map((r) => r.add_player_id as string));

  const points = new Map<string, number>();
  for (const stat of statRows ?? []) {
    points.set(stat.player_id as string, round2(Number(stat.computed_pts)));
  }

  return rows.map((row) => ({
    model: nameOf.get(row.team_id as string) ?? 'unknown',
    player: (row.players as unknown as { name: string } | null)?.name ?? (row.add_player_id as string),
    bid: Number(row.bid),
    points_this_week: points.get(row.add_player_id as string) ?? null,
  }));
}
