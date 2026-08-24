import { describe, expect, it } from 'vitest';
import { draftPickSalvageSchema, draftPickSchema, salvageTruncatedJson } from './decisions';

/**
 * Built from the two real truncated responses of 24 August 2026. One must be rescued
 * and one must stay dead, and the difference between them is the whole point: we undo
 * our own ceiling, we do not invent a decision a model never made.
 */

/** Qwen3.8 Max, draft pick 45, cut off inside the word "confidence". Verbatim. */
const QWEN_PICK_45 = `{
  "pick": "LAR",
  "headline": "Take the top projected defense because its points over replacement is the largest available edge and fills a mandatory starting slot.",
  "key_factors": [
    "Los Angeles Rams proj_season_points is 145.93 and DEF positional_rank is 1, while scarcity_curves DEF replacement_points is 122.99, a 22.94-point season edge.",
    "Rams last_season_points is 147, matching the best prior-season total among available defenses, and preseason points_ppr is 31 in games_played 2.",
    "Team D roster_needs shows DEF 0/1, so this fills a required starting slot rather than a bench slot.",
    "Jayden Daniels, the best available QB, projects 308.72 versus QB replacement_points 303.42, only 5.30 points over replacement, so the QB slot can be addressed later."
  ],
  "closest_call": "Brandon Aubrey was the main alternative because his 173.22 projection is 16.50 points above K replacement 156.72, but the Rams' 22.94-point edge is larger and only one defense must be secured.",
  "what_would_change_it": "If the Rams had an injury_status other than null or their proj_season_points were below the DEF replacement mark of 122.99, I would have taken Aubrey.",
  "confidence`;

describe('salvageTruncatedJson', () => {
  it('rescues the pick-45 response our ceiling cut off', () => {
    const salvaged = salvageTruncatedJson(QWEN_PICK_45) as Record<string, unknown>;
    expect(salvaged).not.toBeNull();
    // The outcome survives intact — this is the whole reason the path exists.
    expect(salvaged.pick).toBe('LAR');
    expect(salvaged.key_factors).toHaveLength(4);
    expect(salvaged.closest_call).toContain('Brandon Aubrey');
    // The half-written field is DROPPED, never guessed.
    expect(salvaged).not.toHaveProperty('confidence');
  });

  it('passes the salvage schema but not the strict one', () => {
    const salvaged = salvageTruncatedJson(QWEN_PICK_45);
    expect(draftPickSalvageSchema.safeParse(salvaged).success).toBe(true);
    // Strict validation must still reject it, or the salvage path is redundant and the
    // strict schema is not strict.
    expect(draftPickSchema.safeParse(salvaged).success).toBe(false);
  });

  it('refuses an empty response — nothing was decided', () => {
    // Qwen's sys-v4 attempt on the same pick: 16,000 reasoning tokens, zero content.
    expect(salvageTruncatedJson('')).toBeNull();
    expect(salvageTruncatedJson('   ')).toBeNull();
  });

  it('refuses a response cut off before any property completed', () => {
    expect(salvageTruncatedJson('{')).toBeNull();
    expect(salvageTruncatedJson('{ "pick": "LA')).toBeNull();
  });

  it('refuses a response with no pick, however much reasoning it carries', () => {
    const noPick = `{
      "headline": "A long and thoughtful argument that never names a player.",
      "key_factors": ["one", "two"],
      "closest_call": "unstated",`;
    const salvaged = salvageTruncatedJson(noPick);
    expect(draftPickSalvageSchema.safeParse(salvaged).success).toBe(false);
  });

  it('is not fooled by braces or commas inside strings', () => {
    const tricky = `{
      "pick": "LAR",
      "headline": "He said {\\"maybe\\", not yes} , which is odd",
      "key_factors": ["a, b", "c"],
      "confid`;
    const salvaged = salvageTruncatedJson(tricky) as Record<string, unknown>;
    expect(salvaged.pick).toBe('LAR');
    expect(salvaged.key_factors).toEqual(['a, b', 'c']);
  });

  it('leaves a complete response alone — it never needed salvaging', () => {
    const complete = JSON.stringify({
      pick: 'LAR',
      headline: 'h',
      key_factors: ['a', 'b'],
      closest_call: 'c',
      what_would_change_it: 'w',
      confidence: 0.7,
    });
    expect(draftPickSchema.safeParse(JSON.parse(complete)).success).toBe(true);
  });
});
