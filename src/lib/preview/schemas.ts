/**
 * Schemas for the Thursday weekend guide.
 *
 * Kept out of `src/lib/schemas/decisions.ts` on purpose: that file's `SCHEMAS` map
 * defines `DecisionType`, which is the set of calls that decide the season. A game
 * take decides nothing — it moves no roster and spends no budget — and adding it
 * there would widen the season's audit vocabulary to include commentary.
 */

import { z } from 'zod';

/**
 * One model's take on one game.
 *
 * Two audiences, two fields, both required. The split is the product: `novice_point`
 * has to stand alone with no football knowledge assumed, and `expert_point` has to
 * survive a reader who already knows the number being cited. Collapsing them into one
 * "analysis" field reliably produces something that serves neither.
 */
export const gameTakeSchema = z.object({
  /** One sentence, no jargon, no player stats assumed. */
  novice_point: z.string().min(1),
  /** One sentence that cites a specific number from the DATA block. */
  expert_point: z.string().min(1),
  /** A player_id from the DATA block. */
  player_to_watch: z.string().min(1),
  /** The thing most likely to make this take wrong. */
  swing_factor: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type GameTake = z.infer<typeof gameTakeSchema>;

export const GAME_TAKE_EXAMPLE = {
  novice_point: 'One sentence a person who has never watched this team could repeat.',
  expert_point: 'One sentence citing a specific field and value from the DATA block.',
  player_to_watch: 'player_id',
  swing_factor: 'The thing most likely to make this take wrong.',
  confidence: 0.6,
};

/**
 * The assembled article, written by the non-competing beat writer.
 *
 * Structured per game rather than one blob of markdown. The first version returned a
 * single `column_md` and the layman line — the whole point of the novice half — ended
 * up buried mid-paragraph, where nobody can grab it. A required field per game is
 * enforceable by schema; "please start each section with a one-liner" is a formatting
 * instruction a model may quietly ignore.
 */
export const weekendGuideSchema = z.object({
  headline: z.string().min(1),
  standfirst: z.string().min(1),
  games: z
    .array(
      z.object({
        game_key: z.string().min(1),
        /**
         * ONE sentence, repeatable out loud, no numbers required. This is the thing a
         * reader says to someone else — if it needs a stat to make sense, it belongs
         * in `body_md` instead.
         */
        takeaway: z.string().min(1),
        /** The fuller section, including where the models disagree. */
        body_md: z.string().min(1),
      }),
    )
    .min(1),
});

export type WeekendGuide = z.infer<typeof weekendGuideSchema>;

export const WEEKEND_GUIDE_EXAMPLE = {
  headline: 'One line, under 90 characters.',
  standfirst: 'Two sentences telling a reader what they will get out of this.',
  games: [
    {
      game_key: 'AWAY@HOME',
      takeaway: 'One sentence someone could say out loud at a bar and sound informed. No stats needed.',
      body_md: 'The fuller section. Cite the numbers here, and name where the models disagree.',
    },
  ],
};
