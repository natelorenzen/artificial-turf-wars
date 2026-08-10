---
title: "Our draft is 120 picks long. Bryce Young's ADP is 121."
summary: "Eight models argued about eight players the market and our projections disagree most about. Seven boards barely moved. On the eighth, a 3-5 minority became 8-0 unanimous — and the argument that turned it was not about football. It was a fact about the shape of our league that five models had missed and three had not."
date: 2026-08-10
kicker: Findings 007
evidence: "Full transcript, every round, in `debate-runs/2026-ba617d34-live-1786394255334.json`. Re-runnable with `scripts/chalk-or-walk.ts --skip=4 --live`."
---

Two weeks before the draft we ran the debate mechanic again, on a board nobody chose by
hand. The rule picks the players where our projection and the market disagree most, at
each position, and steps down a ranked list to produce each new slate — so the board is
the same board whether or not we like the answer it produces.

Eight models. Four rounds. Each takes **CHALK** (the market is right about this player at
this price) or **WALK** (the market is wrong) on all eight players, blind, before seeing
anybody. Then challenges, fired simultaneously so nobody speaks last. Then rebuttals.
Then the same question again.

The product is not the verdict. It is the difference between the first answer and the
last one.

## The board

| Player | Pos | Our proj (rank) | ADP (rank) | R0 | R3 |
|---|---|---|---|---|---|
| Trevor Lawrence | QB | 303.4 (8) | 81 (12) | 5C / 3W | 5C / 3W |
| **Bryce Young** | QB | 235.6 (24) | 121 (19) | **3C / 5W** | **8C / 0W** |
| Quinshon Judkins | RB | 196.0 (23) | 89 (28) | 2C / 6W | 3C / 5W |
| Rico Dowdle | RB | 161.1 (30) | 74 (25) | 0C / 8W | 0C / 8W |
| Ladd McConkey | WR | 228.2 (15) | 50 (24) | 0C / 8W | 0C / 8W |
| Jaylen Waddle | WR | 221.0 (22) | 30 (14) | 0C / 8W | 0C / 8W |
| Kenyon Sadiq | TE | 131.1 (24) | 158 (27) | 8C / 0W | 8C / 0W |
| Dalton Schultz | TE | 133.5 (23) | 134 (19) | 7C / 1W | 8C / 0W |

Five of the eight never moved at all. Three of those were unanimous from the first
answer — Rico Dowdle, Ladd McConkey and Jaylen Waddle, all WALK, all eight models saying
the market has them wrong before any of them knew the others existed.

Then there is Bryce Young.

## The argument

At R0 the majority said WALK, and the case is straightforward. The market drafts him as
the 19th quarterback. Our projection has him 24th at 235.6 points. That is a five-rank
overpay for a player whose efficiency has never justified his draft capital.

Three models said CHALK anyway. Gemini 3.1 Pro put it most bluntly, at 0.90 confidence:

> At ADP 121, he is essentially the last pick of the draft. That is a perfectly
> reasonable price for a dart-throw backup QB. The market is right.

In the challenge round, Claude Opus 5 made the same point with the arithmetic attached:

> League context is 8 teams x 15 roster spots = 120 picks. A player whose market ADP is
> 121 is a free agent in this format, so there is no acquisition cost to overpay. A
> projection gap between QB19 and QB24 at a price of zero cannot be a mispricing; it is
> definitionally chalk.

**Eight teams, fifteen rounds, 120 picks. Young's ADP is 121.** He does not get drafted.
The five-rank gap is real, correctly calculated, and worth nothing, because the thing it
prices is free.

This is not a football argument. Nothing about Young changed. What changed is that three
models were reasoning about the league they were actually in and five were reasoning
about a draft board in the abstract.

## It was not a walkover

Kimi K3 challenged it, and the objection is a good one:

> That conflates low absolute cost with correct pricing. The market still ranks Young
> QB19 against our QB24/235.6-point projection — relative mispricing doesn't disappear
> just because the sticker price is small, and 0.90 is an indefensible confidence level
> on a five-rank divergence.

Its evidence put the distinction plainly — "Cheap and correctly priced are different
claims" — and that is true as a general principle. It loses here for a specific reason: in a
120-pick draft an ADP of 121 is not a small price, it is *no* price, and a ratio with
zero on the bottom is not a small number but an undefined one.

Qwen3.7 Plus objected from the other direction, and got the format wrong doing it. Its
challenge argued that Young's ADP prices him as a startable quarterback, on the grounds
that "16 QBs are started" in this league. Eight teams start one quarterback each; eight
are started. The error cut against its own case, because QB19 is further from startable
than it thought.

Both then conceded. All five flippers cited the same roster arithmetic on the way across:

> **Kimi K3:** G's roster math persuaded me: 8x15=120 picks, so ADP 121 is undrafted in
> this format.

> **Qwen3.7 Plus:** In an 8-team, 15-man league, exactly 120 players are drafted. An ADP
> of 121 means Young is a free agent. You cannot overpay…

**Held CHALK throughout:** GPT-5.6 Sol, Claude Opus 5, Gemini 3.1 Pro.
**Crossed over:** Grok 4.5, Muse Spark 1.1, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus.

## And it does not always converge

Trevor Lawrence ended exactly where he started, 5–3, and the tally hides two flips that
cancelled out. Gemini 3.1 Pro went CHALK to WALK. DeepSeek V4 Pro went WALK to CHALK.
Each was persuaded, by a different argument, in a different direction, in the same round.

That is worth more than the unanimous columns. A mechanic where debate always produces
agreement is measuring social pressure. This one produced a genuine standoff on the same
board where it produced a clean reversal.

## The number that matters

Of **eleven flips across the whole board, eight were away from the majority and three
toward it.**

That is the single result which makes the exercise worth publishing. Models moving toward
the crowd is what you would expect from systems trained to be agreeable, and it would
make the debate a measurement of headcount. Movement predominantly *against* the
prevailing position means the arguments are doing the work.

| | |
|---|---|
| Herd rate | 0.273 |
| Dissent survival | 0.667 — six of nine minority positions held |
| Flips | 11 (8 away from the majority, 3 toward) |
| Unanimous players | 4 → 6 |
| Challenges issued | 22, with no analyst staying silent |
| Cost | 31 calls, $1.07 |

## Two things that agree with an earlier run

Ten days ago, in a separate exercise, the same eight models priced a 200-player board
without debating. Jaylen Waddle was called overvalued by five of eight there; here he is a
unanimous WALK. Ladd McConkey was cited as better value than a receiver going thirty picks
earlier; here he is a unanimous WALK too.

Different question, different format, no memory carried between them. Same two answers.

## What this cannot show

That they are right. Every stance on this board is a claim about a season that has not
been played. Rico Dowdle being a unanimous WALK in August means eight models agreed, not
that the market is wrong.

That the debate improved anything. We can measure that movement went against the crowd;
we cannot yet measure whether the models that moved ended up closer to the truth. That
needs results, and results start on 9 September.

That any of this survives contact with new information. The preseason has played exactly
one game. Bryce Young — the player this whole debate turned on — did not take an
offensive snap in it. We are running the same slate again on 17 August, after two more
weeks of football, to find out what a little bit of evidence does to eight settled
opinions.
