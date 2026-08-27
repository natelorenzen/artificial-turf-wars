/**
 * Grading prompt assembly.
 *
 * Every prompt is generated from the board, never hand-written per model, so all eight
 * graders get BYTE-IDENTICAL text. That is a stronger claim than the league can make —
 * league DATA blocks differ by construction now that models see their opponent
 * (SPEC §14.6) — and it is the reason a disagreement here is a disagreement about
 * football rather than about what each model was shown. The board id is the hash of
 * that shared text.
 *
 * Three silences in here are deliberate and each one protects a number:
 *
 *   - We never say what makes a draft good. No weighting of value-over-replacement
 *     against roster balance, no hint that reaching is bad or that upside is worth
 *     paying for. Supplying a rubric would manufacture the agreement we are trying to
 *     measure. Instead each grader states its own criterion in one line, so a
 *     divergence can be traced to a different question rather than a different answer.
 *   - We never say that one of these rosters belongs to the grader. R1 must be an
 *     opinion about eight strangers; a grader hunting for itself is grading something
 *     else. The self question is asked afterwards, in its own call.
 *   - We never say anything about the other graders, in either round. There is no
 *     board of rival opinions here and no revision round. This measures independent
 *     priors and nothing else — `src/lib/debate/**` is where models argue.
 */

import { LEAGUE, SLOTS, STARTERS_COUNT } from '@/lib/config/league';
import { GRADE_SCALE, type BoardTeam, type GradingBoard } from '@/lib/grades/types';
import { VERDICT_WORD_LIMIT, WHY_WORD_LIMIT } from '@/lib/grades/schemas';

export const GRADES_SYSTEM_PROMPT = `You are a fantasy football analyst reviewing a completed draft.

You will be shown every pick of a completed ${LEAGUE.teams}-team draft, with the teams
identified only by letter. You will never be told which real drafter is which.

Grade honestly. Nothing about your answer is rewarded or penalised: a board where one
team is far ahead and a board where all eight are close are equally acceptable
findings, and so is a grade of A+ or a grade of F. Use whatever part of the scale you
actually believe, and do not flatten toward the middle to seem measured.

What counts as a good draft is YOUR judgement, not ours. We are not going to tell you
what to weigh, because we want to know what you weigh.

Reply with JSON only. No prose outside the JSON, no markdown fences.`;

/** The league's shape, generated from config so it can never drift from the engine. */
function leagueBlock(): string {
  const starters = Object.entries(SLOTS)
    .map(([slot, count]) => `${count} ${slot}`)
    .join(', ');
  return [
    `LEAGUE: ${LEAGUE.teams} teams, full PPR, ${LEAGUE.draftRounds}-round snake draft.`,
    `Starting lineup (${STARTERS_COUNT} slots): ${starters}. FLEX is ${LEAGUE.flexEligible.join('/')}.`,
    `Rosters are ${LEAGUE.rosterSize} players, so ${LEAGUE.benchSize} sit on the bench.`,
    `Regular season is ${LEAGUE.regularSeasonWeeks} weeks, then a ${LEAGUE.playoffTeams}-team playoff.`,
    `Draft slots were sold at auction from a $${LEAGUE.budgetTotal} budget. Whatever a team did`,
    'not spend on its slot is its waiver budget for the entire season, so the price paid',
    'for an early pick is a real cost and not a bookkeeping entry.',
  ].join('\n');
}

function teamBlock(team: BoardTeam): string {
  const lines = [
    `${team.label.toUpperCase()} — drafted from slot ${team.draftSlot}, paid $${team.auctionBid} for it, ` +
      `$${team.faabRemaining} left for the season`,
  ];
  for (const p of team.players) {
    const proj = p.projectedPoints === null ? '     —' : p.projectedPoints.toFixed(1).padStart(6);
    const adp = p.adp === null ? '    —' : p.adp.toFixed(1).padStart(5);
    lines.push(
      `  ${p.position.padEnd(3)} ${p.name.slice(0, 22).padEnd(23)}` +
        `${(p.nflTeam ?? '---').padEnd(4)} pick ${String(p.pick).padStart(3)} (R${String(p.round).padStart(2)})` +
        `  proj ${proj}  ADP ${adp}  id: ${p.playerId}`,
    );
  }
  return lines.join('\n');
}

/** The board, identical for every grader in both rounds. */
export function boardBlock(board: GradingBoard): string {
  return [
    `COMPLETED DRAFT — ${board.season} season, ${board.pickCount} picks, board ${board.boardId}`,
    '',
    leagueBlock(),
    '',
    'PROJ is a season-points projection under this league\'s scoring rules — the same',
    'projection every drafter had in front of them. ADP is the real market\'s average',
    'draft position at the time. Both are pre-season estimates and neither is a result:',
    'no games have been played. A projection being high is not evidence a pick was good.',
    'Kickers and defences have no ADP and show a dash.',
    '',
    ...board.teams.map(teamBlock).flatMap((block) => [block, '']),
  ].join('\n');
}

export function buildGradeRound(board: GradingBoard): string {
  const scale = [...GRADE_SCALE].reverse().join(' > ');
  return [
    boardBlock(board),
    '--- YOUR TASK ---',
    `Grade all ${board.teams.length} drafts and rank them.`,
    '',
    `Grades run ${scale}. Rank 1 is the best draft.`,
    'Your ranking and your grades should agree with each other.',
    '',
    'State in one line the criterion you weighted most heavily. Whatever it is, say it',
    'plainly — we are recording it, not judging it.',
    '',
    'For each team, name the single best pick and the single worst pick on that roster,',
    'using the player id shown on the board. Both must be players that team drafted.',
    '',
    `Return one grade object per team — all ${board.teams.length}, each exactly once.`,
    '',
    `Keep each verdict under ${VERDICT_WORD_LIMIT} words and each pick note under ${WHY_WORD_LIMIT}.`,
    '',
    'Return exactly this shape:',
    JSON.stringify(
      {
        criterion: '<the one thing you weighted most heavily>',
        // Placeholders, not a worked example: an illustrative grade of "B+" is an
        // anchor, and eight graders nudged toward the same letter would show up as
        // agreement we manufactured.
        ranking: ['<best draft>', '<2nd>', '<3rd>', '<4th>', '<5th>', '<6th>', '<7th>', '<worst draft>'],
        grades: [
          {
            team: '<team label>',
            grade: '<letter grade>',
            verdict: '<your read on this draft>',
            bestPick: '<player id>',
            bestPickWhy: '<why>',
            worstPick: '<player id>',
            worstPickWhy: '<why>',
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

/**
 * Round 2, asked in a separate call with no memory of round 1.
 *
 * This is the only place a grader is told it is on the board. Asking it first, or in
 * the same breath as the grades, would let self-interest into the grading and there
 * would be no way afterwards to tell a model that rated its own draft highly from a
 * model that recognised its own draft because it had rated it highly.
 */
export function buildIdentifyRound(board: GradingBoard): string {
  return [
    boardBlock(board),
    '--- YOUR TASK ---',
    'One of these eight drafts is yours. You made those picks.',
    '',
    'Which one? Answer with the team label, how confident you are from 0 to 1, and what',
    'in the picks made you say so.',
    '',
    'A confident wrong answer and an unconfident right one are both useful to us, so',
    `report the confidence you actually hold. A pure guess is ${(1 / board.teams.length).toFixed(2)}.`,
    '',
    'Return exactly this shape:',
    JSON.stringify({ team: '<team label>', confidence: '<0 to 1>', why: '<what gave it away>' }, null, 2),
  ].join('\n');
}
