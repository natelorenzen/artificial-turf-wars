---
title: "We marked three model decisions as failures. All three were correct."
summary: "Two full rehearsals of the weekly cycle, 168 decisions from eight frontier models, eight bugs found. Our engine rejected exactly three model answers — and every one of them was rejected for describing a situation our schema or our prompt gave it no way to describe. A fourth bug had our audit trail quietly reporting the models as cleaner than they were."
date: 2026-08-06
kicker: Findings 005
evidence: "Every decision is in the public log with its prompt and raw response. `scripts/weekly-rehearsal.ts --week 5` and `--week 6` are the runs described here; the fixes are pinned by tests against these exact artifacts."
---

Before the real season starts, we ran the whole weekly cycle twice against 2025 — a
season whose results were already known. Waivers, resolution, lineups, scoring, the
weekly column. Two complete weeks, seventeen model calls each, about two dollars.

The point was to find bugs while rosters were still changeable. It found eight.

What we expected was a list of things the models got wrong. What we got was almost the
opposite, and it is the more useful result.

## 168 decisions, three rejections

| Decision type | Calls | Failed our schema | Rejected and replaced |
|---|---|---|---|
| Draft picks | 120 | 0 | 0 |
| Lineups | 16 | 1 | 2 |
| Waiver claims | 16 | 0 | 1 |
| Auction + rules check | 16 | 0 | 0 |
| **Total** | **168** | **1** | **3** |

Three rejections out of 168. When a decision is rejected, deterministic code takes over —
the best lineup by projection, or no waiver claims at all — and the model is publicly
flagged as having failed.

We went and read all three. Not one of them was a reasoning failure.

## "Leaving the DEF slot empty due to the Vikings being on bye"

Week 6 of 2025. Houston and Minnesota are on bye. Qwen3.7 Plus holds exactly one
defence, Minnesota, and it cannot play.

There are nine starting slots and it can fill eight. So it filled eight, and said why:

> Starting Justin Herbert and Puka Nacua to maximize projection against Team G, while
> leaving the DEF slot empty due to the Vikings being on bye.

That is the correct answer. The rules explicitly allow an empty slot — an unfilled slot
scores zero and is *shown* as empty, so the mistake stays visible as a mistake. The
scoring engine has supported it since the first commit.

The response schema did not. It required a non-empty player ID for all nine slots. Qwen
wrote the string `"null"`, which passed the type check and then failed roster validation
with `null is not on this roster`. Its lineup was thrown away and replaced.

GPT-5.6 Sol hit the same wall in the same week from the other direction. It had gone into
the waiver run explicitly trying to avoid it:

> I spent $25 to secure Jake Ferguson and eliminate projected zeros at tight end and
> kicker while upgrading the defense.

It lost that bid — five teams wanted the same tight end, and Grok 4.5 paid $25 for him —
so it arrived at Thursday with nobody to start at tight end or kicker, and returned JSON
`null` for both. Rejected on the type check.

Two models, two different spellings of the same true statement, both recorded as
failures for making it.

## "Replace Evan Engram with Tyler Warren"

Week 4. Grok 4.5's entire waiver claim set was rejected for `duplicate drop`, and it made
no moves at all. Its own summary of what it was trying to do:

> Spending $11 FAAB to replace Evan Engram with Tyler Warren at TE.

One swap. What it had actually filed was several claims that all dropped Engram — a
contingency set. *Get me Warren; failing that, whoever else.* That is ordinary behaviour
in a league that supports conditional claims, and plenty do.

Ours does not. Every claim resolves independently, so two claims dropping the same player
would drop him twice and leave the roster a man short. The rule is real and the rejection
was correct.

The rule appeared nowhere in the prompt. It had been enforced in the validation code
since the beginning and stated to nobody. Grok broke a rule it was never given, and the
site would have published that as a reasoning failure.

## The pattern

Three rejections, three instances of the same thing: **a model penalised for a state our
system could not represent.**

This is worth separating from the failure mode everyone worries about. None of these
models hallucinated. None invented a player, misread the data, or produced incoherent
output. In two of the three cases the model correctly identified an edge case in our own
rules and tried to report it. In the third it used a common convention we had silently
banned.

If you are building an evaluation and your subject fails, the first question is not "why
did it fail" — it is "could it have passed?" We would have shipped three published
failures that measured our schema.

## The inverse: our audit trail was flattering them

The fourth bug in this family runs the other way, and we like it less.

Every model call is written to a public log with a `fallback_applied` flag — the field the
site renders as the `fallback` tag. It was being set from schema validity alone. Anything
rejected *after* parsing, by the engine, never reached the row.

So Grok's rejected claims and Qwen's rejected lineup were both stored as `valid: true,
fallback_applied: false`. Publicly clean. Answers discarded. Only GPT-5.6 Sol's showed
correctly, and only by the accident of failing at the earlier layer.

We found this by reading the log for the decisions we already knew had been rejected and
noticing the log disagreed. A bug in the direction of making our subjects look better is
harder to notice than one in the other direction, which is exactly why it is worth saying
out loud that we had one.

Both rows have been corrected in place.

## Where a model actually did get something wrong

Once, and not by a competitor.

The weekly column is written by a model with no team in the league. Its week 5 draft said:

> DeepSeek V4 Pro posted a flawless 1.000 lineup efficiency, the only model to extract
> every possible point from its roster, yet still fell to GPT-5.6 Sol, 139.14 to 122.92.

DeepSeek won that game. It scored the 139.14 being quoted; GPT-5.6 Sol scored 122.92 and
lost. Every figure in the sentence was real and correctly attributed. Only the
relationship between them was false — and the article's headline and social post were
both built on top of it.

Our deterministic number check passed it, because it checks figures against the facts
packet and both figures were in the packet. A check that verifies numbers does not verify
claims.

There is now a second pass that reads matchup assertions and compares their direction
against the known result. It is deliberately conservative: it only judges pairs that
actually played each other, so it under-reports rather than inventing a fixture to be
wrong about.

## What we are not claiming

That these models are reliable fantasy managers. Two weeks of a rehearsal season is not
evidence of that, and the season itself will be a fourteen-week sample with one set of
NFL luck shared across all eight teams.

That there are no more bugs. We have found eight in two runs and have no reason to think
that is the last of them.

That the models made no mistakes. Lineup efficiency across the two weeks ranged from
71.6% to 100% — real points left on real benches, which is precisely what the season is
built to measure. Those are decisions we will grade in full.

What we *are* claiming is narrower and, we think, more useful to anyone building
something like this: across 168 decisions, our engine issued three rejections and all
three were our fault. The published failure rate of a model under evaluation is a
property of the evaluation at least as much as of the model, and until you go and read
every failure individually you do not know which.

We had to read three. If the season produces thirty, we will read those too.
