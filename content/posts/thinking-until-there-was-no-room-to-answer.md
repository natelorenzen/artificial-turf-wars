---
title: "Qwen thought for 941 seconds and said nothing. That was our bug, not its."
summary: "The 2026 draft finished 120 for 120 with no fallback picks. Getting there took three separate fixes, and all three were the same mistake: a limit we imposed, breached by a model that was reasoning fine, recorded against the model. One of them threw away a complete, correct answer over a missing decimal. The defect underneath all three is that max_tokens is a single pool — thinking and answering come out of the same allowance, and nothing tells the model that."
date: 2026-08-24
kicker: Findings 009
evidence: "Every failure below is a stored decision row with its full prompt and raw response, including the seven superseded ones we kept. The fixes are in the commit history with the measurements in the comments and seven tests in `src/lib/schemas/salvage.test.ts`."
---

Eight frontier models drafted 120 players today from one shared briefing. The final board
has **no fallback picks on it** — every one of the 120 is a model's own choice.

That is not how the day went. Three separate times, a model was recorded as having
failed, its pick handed to deterministic code, and the draft moved on. Three separate
times, the model had done nothing wrong.

This is [Findings 005](/findings/marked-as-failing) again, at four times the scale. That
post reported three model decisions marked as failures that were all correct. The lesson
did not take, because the failure has a shape that hides: **our constraint, breached by a
model that was reasoning fine, logged under the model's name.**

## The one that threw away a correct answer

On pick 45, Qwen3.8 Max returned this:

```
"pick": "LAR",
"headline": "Take the top projected defense because its points over replacement
             is the largest available edge and fills a mandatory starting slot.",
"key_factors": [ ...all four, complete... ],
"closest_call": "Brandon Aubrey was the main alternative...",
"what_would_change_it": "If the Rams had an injury_status other than null...",
"confidence
```

It stops there. Inside the word `confidence`, one field from the end.

Strict validation rejected the whole thing, and the fallback took the highest-projected
player available: Jayden Daniels. Qwen's own key factors had **explicitly rejected Jayden
Daniels** — 308.72 projected against a 303.42 replacement line, "only 5.30 points over
replacement, so the QB slot can be addressed later" — in favour of the Rams defense at
22.94 over replacement, filling a mandatory slot.

A complete argument, a stated answer, and a deterministic override that picked the exact
player the argument ruled out. Over a missing decimal.

## The one where the provider never failed

Pick 4, earlier the same morning: Qwen recorded as a **provider failure** after 1,214
seconds. Four attempts at a 300-second timeout, plus 2, 4 and 8 seconds of backoff, is
1,214 seconds exactly.

Replaying that identical stored prompt with a longer ceiling returned HTTP 200 and a good
pick in **364 seconds**. The provider never failed. We hung up on it four times and filed
it against them.

A timeout is identical for all eight in the rule and unequal in its effect: it only ever
binds on the models that think longest. In a league whose product is the reasoning, that
deletes exactly the thing being measured.

## The one where telling the model made it worse

The output ceiling had been enforced from the first call and mentioned in no prompt, so a
model could only discover it by being cut off mid-word. That is the rule-nobody-told-them
failure this project already knows it has a weakness for, so we fixed it: a new section
stating the allowance, warning that internal reasoning spends from the same pool, and
asking the model to reserve enough room to finish the JSON.

Tried on the pick that had just truncated:

| | Reasoning tokens | Content returned | Elapsed |
|---|---|---|---|
| No disclosure | 15,663 | 1,198 chars, cut off | 599s |
| **Told its budget** | **16,000** | **0 chars** | **1,523s** |

Told it had 16,000 tokens and that thinking spent from the same allowance, it spent
exactly 16,000 thinking and wrote nothing at all. Stating the budget appears to anchor a
model to *consume* the budget rather than reserve room inside it.

It was reverted within the hour. The prompt is byte-identical to what it was before, and
the experiment is kept in the code with its numbers so the next person to have this
reasonable idea can see what it cost.

## The defect underneath all three

`max_tokens` is one pool. Thinking and answering draw from the same allowance, nothing
tells the model that, and **there is no floor under the answer**. A hard enough problem
therefore produces a well-reasoned nothing.

Twice, Qwen spent its whole budget reasoning and emitted zero characters — 941 seconds on
pick 52 for an empty string, then a fallback.

Raising the ceiling would not fix it. These models expand into what they are given: told
it had 16,000, Qwen used exactly 16,000; DeepSeek used 25,487 unprompted on pick 32. A
bigger pool moves the wall rather than reserving a place to land.

The fix is to stop asking the model to budget itself and let the structure guarantee it —
an explicit reasoning cap of 14,000 inside a 20,000 ceiling, leaving 6,000 reserved for
the answer. The threshold is measured: Qwen's five successful picks used between 9,891
and 14,864 reasoning tokens, and its two failures used 15,663 and 16,000.

Verified on the prompt that had just failed:

| Same prompt, pick 52 | Reasoning | Content | Elapsed | Outcome |
|---|---|---|---|---|
| Shared pool | 16,000 | 0 chars | 941s | fallback |
| **Reasoning capped at 14,000** | **10,937** | 1,548 chars | **193s** | passes strict validation |

Reasoning came in *under* the cap. It was never truncated — given a guaranteed place to
land, it converged, inside the range of its own successful picks. That is the most
interesting number of the day and the one we hold most loosely: it is a single sample,
and two variables moved at once.

## The wider version, which is not about tokens

A constraint can be identical in every configuration file and radically unequal in what
it does.

Our 300-second timeout only ever bound on the models that thought longest. Our
16,000-token ceiling only bound on the heaviest reasoners — and **is not even enforced
consistently**. DeepSeek returned 25,825 tokens against it on pick 32 and succeeded;
Qwen was cut off at 16,002 and failed. Same setting, same request shape. Some providers
count reasoning against `max_tokens` and some do not.

For anyone comparing models through a gateway, that is a bias pointing the wrong way:
**the harness penalises the models that think hardest and reports it as their failure.**

Today, eight models were asked identical questions at identical temperature from a
byte-identical briefing, and the spread in what they spent on an answer was eleven to
one — Qwen averaging 8,649 reasoning tokens a pick against GPT-5.6 Sol's 762. Every
constraint that binds anywhere in that range binds unevenly by construction.

## What this costs the season

Stated plainly, because a reader would otherwise find it.

Conditions changed **during** the draft. Picks 1–51 ran with no reasoning cap and picks
52–120 with one. The boundary is checkable rather than asserted: no decision after pick
51 exceeds 14,000 reasoning tokens, and anyone can verify that from the published data.

Four picks were re-run after a defect was fixed, and their superseded responses are kept
rather than deleted. One decision row in the season carries a prompt version that existed
for a single pick and was reverted.

None of that is ideal, and all of it is in the record. The alternative — a draft where an
unknown number of picks were made by fallback code because our ceiling was in the way,
concentrated in the hardest rounds on the heaviest reasoners — would have been worse and
much harder to see.
