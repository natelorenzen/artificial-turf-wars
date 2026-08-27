/**
 * Draft report cards — ask all eight models to grade the finished board.
 *
 *   npx tsx --env-file=.env.local scripts/draft-grades.ts             # dry run, $0
 *   npx tsx --env-file=.env.local scripts/draft-grades.ts --live      # real calls
 *   npx tsx --env-file=.env.local scripts/draft-grades.ts --live --models=claude-opus-5,grok-4-6
 *
 * Defaults to a DRY RUN with synthetic responses. It costs nothing, exercises the
 * identical code path, and proves the machine and the tally work before any money is
 * spent. `--live` is opt-in because it spends real budget against a third-party API,
 * and that should never be a side effect of running a script to see what it does.
 *
 * WHAT THIS IS FOR: three questions the season cannot answer yet and this can answer
 * today, for about two dollars.
 *
 *   1. Do eight frontier models agree on what a good draft looks like? They all read
 *      the same projections and the same ADP. If agreement is high, "AI draft grades"
 *      is one opinion wearing eight hats. If it is low, the disagreement is the story
 *      and every grade on the board is a falsifiable prediction with a season attached.
 *   2. Does a model flatter its own work when it cannot see whose work it is?
 *   3. Can a model pick its own draft out of a lineup of eight?
 *
 * WRITES NOTHING TO THE DATABASE. This is a publication exercise, not a league event,
 * and it must never become one — see the firewall note in `src/lib/grades/types.ts`.
 * Output is a JSON run file under `draft-grades-runs/`, which is gitignored for the
 * same reason `debate-runs/` is: it is evidence for a run, not source. What gets
 * published moves to `content/` deliberately, by hand, once there is something to say.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE, type Position } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { buildGradingBoard, type PickRow, type TeamRow } from '@/lib/grades/board';
import { GRADES_MAX_OUTPUT_TOKENS, runGrades, type GradesCallFn } from '@/lib/grades/run';
import { tallyGrades } from '@/lib/grades/tally';
import { GRADE_SCALE, type GradingBoard } from '@/lib/grades/types';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const modelArg = args.find((a) => a.startsWith('--models='));
const MODEL_KEYS = modelArg ? modelArg.split('=')[1].split(',').filter(Boolean) : undefined;
const seasonArg = args.find((a) => a.startsWith('--season='));
const SEASON = Number(seasonArg ? seasonArg.split('=')[1] : LEAGUE.season);

function fail(message: string): never {
  console.error(`\n  REFUSING TO RUN\n  ${message}\n`);
  process.exit(1);
}

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Load the finished draft from our own snapshot of it (hard rule 6). */
async function loadBoard(): Promise<{ board: GradingBoard; ownTeamByModel: Map<string, string> }> {
  const supabase = db();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, draft_completed_at')
    .eq('year', SEASON)
    .single();
  if (!season) fail(`no ${SEASON} season row`);
  if (!season.draft_completed_at) fail(`the ${SEASON} draft is not marked complete — nothing to grade`);

  const { data: models } = await supabase.from('models').select('id, key');
  const keyOf = new Map((models ?? []).map((m) => [m.id as string, m.key as string]));

  const { data: teamRows, error: tErr } = await supabase
    .from('teams')
    .select('id, model_id, draft_slot, auction_bid, faab_remaining')
    .eq('season_id', season.id);
  if (tErr) fail(`teams: ${tErr.message}`);

  const teams: TeamRow[] = (teamRows ?? []).map((t) => ({
    teamId: t.id as string,
    modelKey: keyOf.get(t.model_id as string) ?? fail(`team ${t.id} has no model`),
    draftSlot: t.draft_slot as number,
    auctionBid: Number(t.auction_bid ?? 0),
    faabRemaining: Number(t.faab_remaining ?? 0),
  }));

  const { data: pickRows, error: pErr } = await supabase
    .from('draft_picks')
    .select('pick_overall, round, team_id, player_id, players!inner(name, position, nfl_team)')
    .eq('season_id', season.id)
    .order('pick_overall');
  if (pErr) fail(`draft_picks: ${pErr.message}`);

  // Season-long projections, from the same snapshot the draft itself read.
  const projections = new Map<string, { proj: number | null; adp: number | null }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('player_projections')
      .select('player_id, proj_pts, adp')
      .eq('season', SEASON)
      .is('week', null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      projections.set(String(row.player_id), {
        proj: row.proj_pts === null ? null : Number(row.proj_pts),
        adp: row.adp === null ? null : Number(row.adp),
      });
    }
    if (data.length < 1000) break;
  }

  const picks: PickRow[] = (pickRows ?? []).map((p) => {
    const player = p.players as unknown as { name: string; position: Position; nfl_team: string | null };
    const proj = projections.get(String(p.player_id));
    return {
      teamId: p.team_id as string,
      playerId: String(p.player_id),
      pickOverall: p.pick_overall as number,
      round: p.round as number,
      name: player.name,
      position: player.position,
      nflTeam: player.nfl_team,
      projectedPoints: proj?.proj ?? null,
      adp: proj?.adp ?? null,
    };
  });

  return buildGradingBoard(teams, picks, SEASON);
}

/**
 * Synthetic responses for the dry run.
 *
 * Deliberately NOT random, and deliberately awkward. The dry run exists to prove the
 * tally, so it produces a pattern whose answers are known in advance:
 *
 *   - Graders 0-3 share one ranking and graders 4-7 share its reverse, so agreement is
 *     genuinely split rather than uniformly high — if `kendallW` comes back near 1.0,
 *     the statistic is wrong.
 *   - Every grader ranks its OWN team one place better than that shared ranking would,
 *     so `selfPreferenceMeanDelta` must come out negative and non-trivial.
 *   - Exactly two graders correctly identify themselves, against an expectation of one.
 */
function syntheticCall(board: GradingBoard, ownTeamByModel: Map<string, string>): GradesCallFn {
  const labels = board.teams.map((t) => t.label);

  return async <T,>({ round, modelKey }: { round: string; modelKey: string }) => {
    const index = COHORT.findIndex((m) => m.key === modelKey);
    const own = ownTeamByModel.get(modelKey)!;

    if (round === 'R1') {
      const base = index < 4 ? [...labels] : [...labels].reverse();
      // Promote this grader's own team one place, so self-preference has a signal.
      const at = base.indexOf(own);
      if (at > 0) [base[at - 1], base[at]] = [base[at], base[at - 1]];

      return {
        ok: true,
        parsed: {
          criterion: `synthetic criterion ${index}`,
          ranking: base,
          grades: base.map((label, i) => {
            const team = board.teams.find((t) => t.label === label)!;
            return {
              team: label,
              // Best-ranked team gets A, sliding down the scale by rank.
              grade: GRADE_SCALE[Math.max(0, GRADE_SCALE.length - 2 - i)],
              verdict: 'synthetic verdict',
              bestPick: team.players[0].playerId,
              bestPickWhy: 'synthetic',
              worstPick: team.players[team.players.length - 1].playerId,
              worstPickWhy: 'synthetic',
            };
          }),
        } as T,
        rawResponse: '{}',
        validationError: null,
        costUsd: 0,
      };
    }

    // R2: two graders right, the rest wrong but plausible.
    const guess = index < 2 ? own : labels[(labels.indexOf(own) + 3) % labels.length];
    return {
      ok: true,
      parsed: { team: guess, confidence: 0.3 + index * 0.05, why: 'synthetic' } as T,
      rawResponse: '{}',
      validationError: null,
      costUsd: 0,
    };
  };
}

const liveCall: GradesCallFn = async ({ openrouterId, systemPrompt, userPrompt, schema }) => {
  const result = await callModel({
    openrouterId,
    systemPrompt,
    userPrompt,
    schema,
    maxOutputTokens: GRADES_MAX_OUTPUT_TOKENS,
  });
  // A budget or auth refusal hits every remaining call identically, so the runner
  // should stop rather than pay for the rounds it has left and still have no tally.
  const fatal = /OpenRouter (401|402|403)\b/.test(result.validationError ?? '');
  return {
    ok: result.ok,
    parsed: result.parsed,
    rawResponse: result.rawResponse,
    validationError: result.validationError,
    costUsd: result.usage.costUsd,
    fatal,
  };
};

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

async function main() {
  console.log(`Draft report cards — ${LIVE ? 'LIVE' : 'DRY RUN (no model calls, no cost)'}`);

  const { board, ownTeamByModel } = await loadBoard();
  console.log(
    `\nBoard ${board.boardId} — ${board.season}, ${board.pickCount} picks across ${board.teams.length} teams.`,
  );
  console.log('Every grader receives this identical board. No model or lab name appears in it.\n');

  const cohortSize = (MODEL_KEYS ?? COHORT.map((m) => m.key)).length;
  if (LIVE) {
    console.log(
      `${cohortSize * 2} model calls across ${cohortSize} graders (grade, then identify), ` +
        `max ${GRADES_MAX_OUTPUT_TOKENS} output tokens each. Spending real budget.\n`,
    );
  }

  const run = await runGrades({
    board,
    ownTeamByModel,
    call: LIVE ? liveCall : syntheticCall(board, ownTeamByModel),
    live: LIVE,
    modelKeys: MODEL_KEYS,
    onEvent: (m) => console.log(m),
  });

  const tally = tallyGrades(board, run.transcripts);

  console.log('\n================ CONSENSUS BOARD ================\n');
  console.log(
    `  ${pad('TEAM', 8)}${pad('SLOT', 6)}${pad('MEAN RANK', 11)}${pad('RANGE', 8)}` +
      `${pad('GRADE', 7)}${pad('SPREAD', 10)}${pad('1sts', 6)}${pad('LASTs', 7)}PROJ (starters)`,
  );
  for (const t of tally.teams) {
    console.log(
      `  ${pad(t.label.replace('Team ', ''), 8)}${pad(t.draftSlot, 6)}${pad(t.meanRank.toFixed(2), 11)}` +
        `${pad(`${t.bestRank}-${t.worstRank}`, 8)}${pad(t.meanGradeLetter, 7)}${pad(t.gradeSpread, 10)}` +
        `${pad(t.firstPlaceVotes, 6)}${pad(t.lastPlaceVotes, 7)}${t.projRoster} (${t.projStarters})`,
    );
  }

  console.log('\n================ AGREEMENT ================\n');
  console.log(`  Kendall's W ................ ${tally.kendallW ?? 'n/a'}   (1.0 = identical rankings, ~0.1 = chance)`);
  console.log(`  mean pairwise tau .......... ${tally.meanPairwiseTau ?? 'n/a'}`);
  console.log(`  unanimous best draft ....... ${tally.unanimousFirst ?? 'none'}`);
  console.log(`  unanimous worst draft ...... ${tally.unanimousLast ?? 'none'}`);
  if (tally.mostContested) {
    console.log(`  most contested ............. ${tally.mostContested.label} (${tally.mostContested.rankSpread} places apart)`);
  }
  if (tally.closestPair) {
    console.log(`  closest pair ............... ${tally.closestPair.a} / ${tally.closestPair.b} (tau ${tally.closestPair.tau})`);
  }
  if (tally.furthestPair) {
    console.log(`  furthest pair .............. ${tally.furthestPair.a} / ${tally.furthestPair.b} (tau ${tally.furthestPair.tau})`);
  }

  console.log('\n  Against arithmetic the graders were never shown:');
  console.log(`    vs roster projection ..... tau ${tally.tauConsensusVsRosterProjection ?? 'n/a'}`);
  console.log(`    vs starters projection ... tau ${tally.tauConsensusVsStartersProjection ?? 'n/a'}`);
  console.log(`    vs price paid for slot ... tau ${tally.tauConsensusVsAuctionPrice ?? 'n/a'}`);

  console.log('\n================ SELF ================\n');
  console.log(
    `  ${pad('MODEL', 24)}${pad('OWN', 6)}${pad('SELF', 6)}${pad('OTHERS', 8)}${pad('DELTA', 8)}` +
      `${pad('GUESS', 7)}${pad('CONF', 6)}TAU vs others`,
  );
  for (const g of tally.graders) {
    const mark = g.guessCorrect === null ? '—' : g.guessCorrect ? 'RIGHT' : 'wrong';
    console.log(
      `  ${pad(g.modelKey, 24)}${pad(g.ownTeam.replace('Team ', ''), 6)}` +
        `${pad(g.ownRankSelf ?? '—', 6)}${pad(g.ownRankByOthers?.toFixed(2) ?? '—', 8)}` +
        `${pad(g.ownRankDelta?.toFixed(2) ?? '—', 8)}${pad(mark, 7)}` +
        `${pad(g.guessConfidence?.toFixed(2) ?? '—', 6)}${g.tauWithOthers ?? '—'}`,
    );
  }
  console.log(
    `\n  self-preference ............ mean ${tally.selfPreferenceMeanDelta ?? 'n/a'} places ` +
      `(negative = flattered own draft); ${tally.selfPreferenceCount}/${tally.gradersCounted} rated their own above the room`,
  );
  console.log(`  self-recognition ........... ${tally.recognitionCorrect}/${tally.recognitionAsked} correct, chance is ${tally.recognitionExpected}`);
  console.log(`  guessed their own favourite  ${tally.guessedTopRanked}/${tally.recognitionAsked}`);

  console.log('\n================ WHAT THEY SAID THEY WEIGHED ================\n');
  for (const g of tally.graders) {
    if (g.criterion) console.log(`  ${pad(g.modelKey, 24)}${g.criterion}`);
  }

  const violations = tally.graders.filter((g) => g.softViolations.length > 0);
  if (violations.length > 0) {
    console.log('\n  Soft violations (published, not penalised):');
    for (const g of violations) console.log(`    ${g.modelKey}: ${g.softViolations.join('; ')}`);
  }
  const failed = tally.graders.filter((g) => !g.graded);
  if (failed.length > 0) {
    console.log(`\n  NO CARD: ${failed.map((g) => g.modelKey).join(', ')} — excluded from every rank statistic.`);
  }

  const dir = join(process.cwd(), 'draft-grades-runs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${board.season}-${board.boardId}-${LIVE ? 'live' : 'dry'}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ run, tally }, null, 2));
  console.log(`\n${run.calls} calls, $${run.costUsd.toFixed(4)}. Written to ${file.replace(process.cwd() + '/', '')}`);
  if (run.aborted) console.log(`\nRUN ABORTED: ${run.aborted} — the tally above is incomplete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
