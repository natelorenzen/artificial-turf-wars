/**
 * Building one week's guide: eight takes per game, then one assembled article.
 *
 * The eight are the league's competitors, reasoning from a DATA block exactly as they
 * do all season. The assembling writer is the NON-COMPETING beat model
 * (`BEAT_WRITER_MODEL`), for the same reason it writes the weekly wrap: a model with a
 * team in the league should not be the voice that narrates the league to the public.
 *
 * Unlike the memory-only preseason preview, everything here is grounded. Models are
 * given data and told to cite it, and `checkCitations` records anything they assert
 * that the data does not support — published rather than hidden.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BEAT_WRITER_MODEL, LEAGUE } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { checkCitations } from '@/lib/prompt/cited';
import { stableHash } from '@/lib/util/hash';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import {
  GAME_TAKE_EXAMPLE,
  WEEKEND_GUIDE_EXAMPLE,
  gameTakeSchema,
  weekendGuideSchema,
  type GameTake,
} from './schemas';
import { gameDataBlock, type GameContext } from './games';

/** Default number of games the guide covers. */
export const GAMES_PER_GUIDE = 4;

const TAKE_SYSTEM = `You are a football analyst producing one bounded take on one NFL game.

DATA RULE (highest priority):
Reason only from the DATA block in this message. Do not use your own memory
of rosters, depth charts, injuries, results or standings — it is out of date.
If a field is null, treat it as unknown and say so rather than filling it in.

The DATA block contains fantasy projections and recent actual points for
individual players. It contains NO team records, NO scores, NO betting lines
and NO weather. Do not assert any of those, and do not predict a final score
or a winner — nothing here supports that.

You are writing for two readers at once:
- novice_point must be understandable to someone who has never watched
  either team. No jargon, no assumed stats.
- expert_point must cite a specific field and value from the DATA block and
  tell a knowledgeable reader something they could argue with.

Return only a single JSON object matching the schema. No preamble, no
markdown, no code fences.`;

export interface TakeResult {
  modelKey: string;
  modelId: string | null;
  displayName: string;
  openrouterId: string;
  gameKey: string;
  take: GameTake | null;
  raw: string | null;
  valid: boolean;
  contextHash: string;
  citedFields: string[];
  unsupportedClaims: string[];
  costUsd: number;
}

export interface CohortEntry {
  key: string;
  displayName: string;
  openrouterId: string;
  /** DB id, null when running outside a seeded season. */
  modelId: string | null;
}

/**
 * Every model's take on one game.
 *
 * PARALLEL across models, unlike the draft loop, and the difference is not stylistic.
 * The §5.2 "sequential, with a delay" rule is about SLEEPER, whose feed we must not
 * hammer; these are eight different OpenRouter models on eight different upstream
 * providers. Draft picks are sequential because each pick genuinely depends on the
 * previous one — a take does not depend on any other take.
 *
 * It is also what makes the job viable at all. Thirty-three sequential calls run five
 * to eight minutes and a Vercel function is killed at 300s, so the sequential version
 * could never finish in production. Verified the hard way: the first live invocation
 * was killed mid-run having written nothing.
 *
 * `Promise.allSettled`, not `all`: one provider outage must cost one take, not the
 * whole game.
 */
export async function takesForGame(
  context: GameContext,
  week: number,
  cohort: CohortEntry[],
  forbiddenNames: readonly string[],
): Promise<TakeResult[]> {
  const data = gameDataBlock(context, week);
  const serialized = JSON.stringify(data);

  // The DATA block names NFL players freely, but `rostered_in_this_league_by` must
  // carry anonymous labels only — never a lab or model name (SPEC §14.3).
  assertNoLabelLeak(serialized, forbiddenNames);

  const contextHash = stableHash(data);
  const userPrompt = [
    '=== DATA ===',
    serialized,
    '=== END DATA ===',
    '',
    `Give one take on ${context.fixture.away} at ${context.fixture.home}, week ${week}.`,
    'Pick player_to_watch as a player_id that appears in the DATA block.',
    '',
    'Return exactly this JSON shape and nothing else:',
    JSON.stringify(GAME_TAKE_EXAMPLE, null, 2),
  ].join('\n');

  const settled = await Promise.allSettled(
    cohort.map(async (model): Promise<TakeResult> => {
      const call = await callModel({
        openrouterId: model.openrouterId,
        systemPrompt: TAKE_SYSTEM,
        userPrompt,
        schema: gameTakeSchema,
        maxOutputTokens: LEAGUE.maxOutputTokens,
      });

      const citations = call.parsed
        ? checkCitations([call.parsed.expert_point, call.parsed.novice_point], data, '')
        : { citedFields: [], unsupportedClaims: [] };

      return {
        modelKey: model.key,
        modelId: model.modelId,
        displayName: model.displayName,
        openrouterId: model.openrouterId,
        gameKey: context.fixture.gameKey,
        take: call.parsed,
        raw: call.rawResponse,
        valid: call.ok,
        contextHash,
        citedFields: citations.citedFields,
        unsupportedClaims: citations.unsupportedClaims,
        costUsd: call.usage.costUsd ?? 0,
      };
    }),
  );

  return settled.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : {
          // A rejection here is a thrown error rather than a model's bad output —
          // recorded as an invalid take so the failure is visible, not dropped.
          modelKey: cohort[index].key,
          modelId: cohort[index].modelId,
          displayName: cohort[index].displayName,
          openrouterId: cohort[index].openrouterId,
          gameKey: context.fixture.gameKey,
          take: null,
          raw: String(outcome.reason).slice(0, 2000),
          valid: false,
          contextHash,
          citedFields: [],
          unsupportedClaims: [],
          costUsd: 0,
        },
  );
}

// ---------------------------------------------------------------------------
// The article
// ---------------------------------------------------------------------------

const WRITER_SYSTEM = `You are the beat writer for a fantasy football league contested
by eight AI models. You do not have a team in it.

You are given, for several NFL games, the takes those eight models produced from a
shared data block. Write one article: "how to survive this weekend".

Two audiences, together:
- a complete novice, who wants talking points that will not embarrass them;
- a committed expert, who wants something to argue with.

RULES:
1. Use only the takes and figures you are given. Invent no statistic, no injury,
   no score and no betting line.
2. Where the models disagree, say so and name the disagreement. That is the most
   interesting thing you have and it should not be smoothed away.
3. Refer to the models by their display names as given.
4. One "## " heading per game, in the order supplied. Nothing above the first
   heading except the opening paragraphs.
5. No final-score predictions. The underlying data does not support them.

Return only a single JSON object matching the schema. No preamble, no code fences.`;

export interface WriterInput {
  week: number;
  games: {
    gameKey: string;
    away: string;
    home: string;
    kickoffAt: string | null;
    leagueStake: number;
    takes: { model: string; novice: string; expert: string; watch: string; swing: string; confidence: number }[];
  }[];
}

export interface GuideResult {
  guide: { headline: string; standfirst: string; column_md: string } | null;
  raw: string | null;
  valid: boolean;
  factsPacket: WriterInput;
  factsPacketHash: string;
  costUsd: number;
}

export async function writeGuide(input: WriterInput): Promise<GuideResult> {
  const factsPacketHash = stableHash(input);

  const userPrompt = [
    '=== TAKES ===',
    JSON.stringify(input, null, 2),
    '=== END TAKES ===',
    '',
    `Write the week ${input.week} guide.`,
    '',
    'Return exactly this JSON shape and nothing else:',
    JSON.stringify(WEEKEND_GUIDE_EXAMPLE, null, 2),
  ].join('\n');

  const call = await callModel({
    openrouterId: BEAT_WRITER_MODEL,
    systemPrompt: WRITER_SYSTEM,
    userPrompt,
    schema: weekendGuideSchema,
    maxOutputTokens: LEAGUE.maxOutputTokens,
    // The beat writer is INTERMITTENTLY unparseable: the same facts packet produced a
    // clean article on one attempt and malformed JSON on the next. It is also the
    // single point of failure for a run whose expensive work — thirty-two takes — is
    // already stored and paid for, and it is by far the cheapest call in the job.
    // Retrying it harder than the league default is the right trade.
    parseRetries: 5,
  });

  return {
    guide: call.parsed,
    raw: call.rawResponse,
    valid: call.ok,
    factsPacket: input,
    factsPacketHash,
    costUsd: call.usage.costUsd ?? 0,
  };
}

/** Shape the takes into what the writer is given. */
export function toWriterInput(
  week: number,
  contexts: GameContext[],
  takes: TakeResult[],
): WriterInput {
  const byGame = new Map<string, TakeResult[]>();
  for (const t of takes) {
    const list = byGame.get(t.gameKey) ?? [];
    list.push(t);
    byGame.set(t.gameKey, list);
  }

  const nameOf = new Map<string, string>();
  for (const context of contexts) {
    for (const p of [...context.away, ...context.home]) nameOf.set(p.playerId, p.name);
  }

  return {
    week,
    games: contexts.map((context) => ({
      gameKey: context.fixture.gameKey,
      away: context.fixture.away,
      home: context.fixture.home,
      kickoffAt: context.fixture.kickoffAt,
      leagueStake: context.leagueStake,
      takes: (byGame.get(context.fixture.gameKey) ?? [])
        .filter((t): t is TakeResult & { take: GameTake } => t.take !== null)
        .map((t) => ({
          model: t.displayName,
          novice: t.take.novice_point,
          expert: t.take.expert_point,
          // Resolve the id to a name — the writer should not be printing raw ids.
          watch: nameOf.get(t.take.player_to_watch) ?? t.take.player_to_watch,
          swing: t.take.swing_factor,
          confidence: t.take.confidence,
        })),
    })),
  };
}
