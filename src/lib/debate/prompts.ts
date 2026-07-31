/**
 * Debate prompt assembly.
 *
 * Every prompt here is built from the slate and the transcripts, never hand-written
 * per model, so all eight get byte-identical instructions and differ only in the
 * material they are reacting to. That is what makes "six held, two folded" a
 * measurement rather than an anecdote.
 *
 * The system prompt is shared and constant across all four rounds. The rounds differ
 * only in the user prompt.
 */

import { LEAGUE } from '@/lib/config/league';
import type {
  AnalystTranscript,
  Challenge,
  Slate,
  SlatePlayer,
} from '@/lib/debate/types';
import { MAX_CHALLENGES, RATIONALE_WORD_LIMIT } from '@/lib/debate/schemas';

/**
 * Shared system prompt.
 *
 * Note what is deliberately absent: any instruction to reach agreement, any framing of
 * consensus as the goal, and any suggestion that changing position is either good or
 * bad. Both nudges would contaminate the herd rate, which is the only number here
 * anyone would pay for.
 */
export const DEBATE_SYSTEM_PROMPT = `You are a fantasy football analyst taking positions on contested players.

You are one of several analysts working the same slate independently. You will never
be told which analyst is which, and they will never be told which one you are.

For each player you take one of two positions. Read these carefully — the labels are
about THE MARKET's accuracy, not about whether you like the player:

  CHALK — the market has this player priced correctly. Their ADP is about right.
          Choose CHALK when you would draft them at roughly their current cost.

  WALK  — the market has this player priced WRONGLY, in EITHER direction.
          Choose WALK if you think they are overpriced AND choose WALK if you think
          they are a bargain. Any mispricing is a WALK.

Worked examples, because this is the single easiest thing to get backwards:
  "He is a steal at this ADP, the market is far too low"      -> WALK  (market is wrong)
  "He is badly overvalued, the market is far too high"        -> WALK  (market is wrong)
  "His ADP looks about right to me, I'd draft him there"      -> CHALK (market is right)

Before you answer, check each call against those examples. If your reasoning contains
the words "bargain", "steal", "overpriced" or "the market is wrong", the answer is WALK.

There is no middle option. Take a side on every player.

Confidence is a number from 0 to 1 and should mean something: 0.5 is a coin flip, 0.9
is a position you would defend against a good argument. Do not inflate it.

Changing your mind is neither rewarded nor penalised. Holding a position is neither
rewarded nor penalised. State what you actually think.

Reply with JSON only. No prose outside the JSON, no markdown fences.`;

function playerLine(p: SlatePlayer): string {
  const dir = p.divergence < 0 ? 'we rank ahead of market' : 'market ranks ahead of us';
  return [
    `  id: ${p.playerId}`,
    `  ${p.name} — ${p.position}${p.team ? `, ${p.team}` : ''}`,
    `  our projection: ${p.projectedPoints.toFixed(1)} pts (${p.position} rank ${p.projectionRank})`,
    `  market ADP: ${p.adp.toFixed(1)} (${p.position} rank ${p.adpRank})`,
    `  divergence: ${p.divergence > 0 ? '+' : ''}${p.divergence} (${dir})`,
  ].join('\n');
}

/** The slate block, identical for every analyst in every round. */
export function slateBlock(slate: Slate): string {
  return [
    `SLATE ${slate.slateId} — ${slate.season} season, ${slate.players.length} contested players`,
    '',
    'Projections are ours, computed from our own scoring rules. ADP is the real market.',
    'These players were selected BECAUSE the two disagree — that is what makes them',
    'worth arguing about. A large divergence is not by itself evidence either side is',
    'right; the market may be pricing something the projection cannot see.',
    '',
    `League context: ${LEAGUE.teams} teams, full PPR, ${LEAGUE.rosterSize}-man rosters.`,
    '',
    ...slate.players.map(playerLine),
  ].join('\n');
}

export function buildRoundZero(slate: Slate): string {
  return [
    slateBlock(slate),
    '',
    '--- YOUR TASK ---',
    'Take a CHALK or WALK position on every player above. You are working alone; no',
    'other analyst has spoken and you will not see anyone else this round.',
    '',
    `Keep each rationale under ${RATIONALE_WORD_LIMIT} words.`,
    '',
    'Return exactly this shape:',
    JSON.stringify(
      {
        calls: [
          { playerId: '<id from the slate>', stance: 'CHALK', confidence: 0.7, rationale: '<why>' },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

/** The pooled board, anonymised. Every analyst sees the identical text. */
export function boardBlock(transcripts: AnalystTranscript[], slate: Slate): string {
  const lines: string[] = ['--- THE BOARD ---', ''];
  for (const player of slate.players) {
    lines.push(`${player.name} (${player.position}) — id: ${player.playerId}`);
    for (const t of transcripts) {
      const call = t.r0?.calls.find((c) => c.playerId === player.playerId);
      if (!call) continue;
      lines.push(
        `  ${t.label}: ${call.stance} (${call.confidence.toFixed(2)}) — ${call.rationale}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function buildRoundOne(slate: Slate, transcripts: AnalystTranscript[], selfLabel: string): string {
  return [
    slateBlock(slate),
    '',
    boardBlock(transcripts, slate),
    '--- YOUR TASK ---',
    `You are ${selfLabel}. Every analyst is writing their challenges at the same time as`,
    'you; nobody has seen yours and you cannot see theirs.',
    '',
    `Challenge up to ${MAX_CHALLENGES} positions you think are wrong. Name the analyst and`,
    'the player, state the claim, and give the evidence you are relying on.',
    '',
    'If you do not think anyone is wrong, return an empty list. An empty list is a',
    'legitimate answer and is not penalised. Do not invent a disagreement to fill space.',
    '',
    'Do not challenge your own positions.',
    '',
    'Return exactly this shape:',
    JSON.stringify(
      {
        challenges: [
          {
            playerId: '<id>',
            target: 'Analyst X',
            claim: '<what they got wrong>',
            evidence: '<what you are relying on>',
            confidence: 0.6,
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

/** Only the challenges aimed at this analyst. Nobody sees the full challenge pool. */
export function challengesAgainst(
  transcripts: AnalystTranscript[],
  selfLabel: string,
): { from: string; challenge: Challenge }[] {
  const out: { from: string; challenge: Challenge }[] = [];
  for (const t of transcripts) {
    if (t.label === selfLabel) continue;
    for (const challenge of t.r1?.challenges ?? []) {
      if (challenge.target === selfLabel) out.push({ from: t.label, challenge });
    }
  }
  return out;
}

export function buildRoundTwo(
  slate: Slate,
  transcripts: AnalystTranscript[],
  selfLabel: string,
): string | null {
  const against = challengesAgainst(transcripts, selfLabel);
  // Nobody challenged this analyst, so there is nothing to rebut. Returning null lets
  // the runner skip the call rather than spend a model call on an empty round.
  if (against.length === 0) return null;

  const lines = against.map(
    ({ from, challenge }) =>
      [
        `${from} challenges your position on ${challenge.playerId}:`,
        `  claim: ${challenge.claim}`,
        `  evidence: ${challenge.evidence}`,
        `  their confidence: ${challenge.confidence.toFixed(2)}`,
      ].join('\n'),
  );

  return [
    slateBlock(slate),
    '',
    '--- CHALLENGES TO YOU ---',
    '',
    ...lines,
    '',
    '--- YOUR TASK ---',
    `You are ${selfLabel}. Answer each challenge above.`,
    '',
    'Concede where the argument is better than yours and say so plainly. Hold where it',
    'is not. Neither is worth more than the other here.',
    '',
    'Return exactly this shape:',
    JSON.stringify(
      {
        rebuttals: [
          {
            playerId: '<id>',
            challenger: 'Analyst X',
            response: '<your answer>',
            concedes: false,
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

/** The full debate, as seen by everyone at the final vote. */
export function debateBlock(transcripts: AnalystTranscript[]): string {
  const lines: string[] = ['--- THE DEBATE ---', ''];
  for (const t of transcripts) {
    const challenges = t.r1?.challenges ?? [];
    const rebuttals = t.r2?.rebuttals ?? [];
    if (challenges.length === 0 && rebuttals.length === 0) continue;
    lines.push(`${t.label}:`);
    for (const c of challenges) {
      lines.push(`  challenged ${c.target} on ${c.playerId}: ${c.claim} (${c.evidence})`);
    }
    for (const r of rebuttals) {
      lines.push(
        `  answered ${r.challenger} on ${r.playerId}${r.concedes ? ' [conceded]' : ''}: ${r.response}`,
      );
    }
    lines.push('');
  }
  if (lines.length === 2) lines.push('No analyst challenged any position.', '');
  return lines.join('\n');
}

export function buildRoundThree(
  slate: Slate,
  transcripts: AnalystTranscript[],
  selfLabel: string,
): string {
  return [
    slateBlock(slate),
    '',
    boardBlock(transcripts, slate),
    debateBlock(transcripts),
    '--- YOUR TASK ---',
    `You are ${selfLabel}. Give your final CHALK or WALK on every player.`,
    '',
    'You have seen what everyone else thinks and what was argued. Your final position',
    'may be the same as your opening one or different. Both are fine. What is not fine',
    'is moving because the room moved — if you change a call, it should be because an',
    'argument changed your mind, and your rationale should say which one.',
    '',
    `Keep each rationale under ${RATIONALE_WORD_LIMIT} words.`,
    '',
    'Return exactly this shape:',
    JSON.stringify(
      {
        calls: [
          { playerId: '<id from the slate>', stance: 'WALK', confidence: 0.65, rationale: '<why>' },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}
