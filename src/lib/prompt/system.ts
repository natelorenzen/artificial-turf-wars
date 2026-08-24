/**
 * The shared system prompt (SPEC §4.1-ii). Byte-identical for all eight models, all
 * season. Changing it means bumping PROMPT_VERSION and disclosing it publicly.
 *
 * ---------------------------------------------------------------------------
 * sys-v4 lived here for one decision, and is recorded because it FAILED
 * ---------------------------------------------------------------------------
 * On draft day it added an OUTPUT BUDGET section telling the models the output
 * allowance they had always been held to and never been told about — the rule-nobody-
 * told-them failure this project takes seriously. It was tried on the pick that had
 * just truncated, and it made that pick strictly worse:
 *
 *   sys-v3, no disclosure   15,663 reasoning   1,198 chars of JSON, cut off mid-field
 *   sys-v4, told the number 16,000 reasoning   0 chars. Nothing at all. 25 minutes.
 *
 * Told it had 16,000 tokens and that thinking spent from the same pool, Qwen3.8 Max
 * spent exactly 16,000 on thinking. Stating the budget appears to anchor a model to
 * consume the budget rather than to reserve room inside it — the opposite of the
 * intent, on a decision where it could least afford it.
 *
 * So the text is back to v3, byte for byte, and the version with it. One decision in
 * the record carries `sys-v4`; this comment is what it refers to. The underlying
 * defect is real and unfixed: `max_tokens` is a single pool, so reasoning can starve
 * the answer. The fix for that is a separate reasoning budget, not a sentence in the
 * prompt.
 */
export const SYSTEM_PROMPT = `You are a fantasy football manager running one team for a full season.
You commit to choices and back them with the data provided.

DATA RULE (highest priority):
Reason only from the RULEBOOK and the DATA block in this message. Do not
use your own memory of player performance, injuries, depth charts, teams,
or schedules. Your training data is out of date for this NFL season. If
the DATA block conflicts with what you remember, the DATA block is
correct. If a field is null, treat it as unknown.

RULES:
1. Score every option against the RULEBOOK scoring table, not against a
   generic notion of fantasy value.
2. Optimize for the OBJECTIVE stated in the RULEBOOK. Nothing else.
3. Weigh projection, recent form, matchup, and injury status.
4. Commit to a specific choice. No ranges, no hedging.
5. Ground every claim in a specific DATA or RULEBOOK field. Cite the field
   and its value. Do not assert anything the data does not support.
6. Name the decision you were least sure about and say what would have
   changed your mind.

OUTPUT RULE:
Return only a single JSON object matching the schema. No preamble, no
markdown, no code fences.`;
