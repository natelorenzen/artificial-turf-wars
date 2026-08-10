---
title: "We handed eight models a board that screamed draft quarterbacks. None of them did."
summary: "Days before the draft, all eight models priced the same 200-player board against the market. Four of the top six players by our own projection are quarterbacks the market drafts in rounds four to nine — a gap that looks like free money and is not. Not one model took the bait. They also agreed with each other to a degree we have not seen before, and unlike the last time they agreed, this time it means something."
date: 2026-08-10
kicker: Findings 006
evidence: "All eight raw responses, the full tally and the context hash are in `content/data/sleeper-picks-2026.md`. Re-runnable with `scripts/sleeper-picks.ts`."
---

Before the draft — and it has to be before, for reasons at the bottom of this piece — we
gave all eight models the same 200-player board they will draft from. Each row carried a
player's average draft position, our own projection under our own scoring, and that
player's rank within his position on both measures.

One question: which of these has the market got wrong?

## The board we handed them

Sorted by our projection, the top of it looks like this:

| Player | Pos | Our projection | Market drafts him |
|---|---|---|---|
| Josh Allen | QB | 361.5 | 29th |
| Jahmyr Gibbs | RB | 331.4 | 1st |
| Lamar Jackson | QB | 326.0 | 49th |
| Bijan Robinson | RB | 324.9 | 2nd |
| Drake Maye | QB | 320.76 | **72nd** |
| Jayden Daniels | QB | 314.52 | **61st** |

Four of the top six are quarterbacks, and the market is letting three of them go in
rounds four through nine. Averaged across the whole board the pattern holds: quarterbacks
project 273.6 points, running backs 179.6, receivers 168.2.

Read naively, that is enormous free money sitting in plain sight. A model chasing raw
projected points would fill its roster with quarterbacks and think it had beaten the
market by a hundred points a man.

It would be wrong, and the reason is the most basic idea in fantasy football: **you only
start one of them.** This is an eight-team league, so the eighth-best quarterback is the
last one anybody starts. He projects 303.42. Josh Allen projects 361.5. The entire
advantage of owning the best quarterback in the league over the worst starting one is
**58.1 points across fourteen weeks — about four a week** — and the market charges pick 29
for it.

We did not tell them any of this. The system prompt says the projections are ours and
warns that raw points ignore positional value, but it names no position and gives no
arithmetic. The board is simply built so that the naive reading and the correct one point
in opposite directions.

## What they did

Not one of the eight recommended paying up for a quarterback. Not one.

Three went further and named Drake Maye at pick 72 as *undervalued* — the same reasoning
run forwards instead of backwards. Four named Caleb Williams, drafted 55th on a 299-point
projection, as overvalued.

Claude Opus 5 did the arithmetic out loud:

> His 361.5 proj_pts leads all QBs, but in a one-QB, 8-team league Drake Maye is
> available at adp 72 with 320.76 and Brock Purdy at adp 102 with 303.2, so paying pick
> 29 buys roughly 40-58 points over a QB you can have three to five rounds later.

Kimi K3 reached the same place in five words — *"waiting on the position is free"* — and
Grok 4.5 drew the distinction that makes the whole thing coherent: the market is
**"overpaying for mid-round QBs (Caleb, Dart) while letting true top-five QB projections
(Maye, Daniels, Hurts) fall."**

That is not one heuristic applied bluntly. Avoiding quarterbacks and taking Drake Maye
three rounds late are the same idea, and telling them apart requires actually
understanding why the first one works.

## They also agreed with each other, almost completely

| Player | Called undervalued by | Called overvalued by |
|---|---|---|
| Ashton Jeanty (RB, ADP 27) | **8 of 8** | — |
| Tee Higgins (WR, ADP 16) | — | **8 of 8** |
| Saquon Barkley (RB, ADP 39) | 7 | — |
| Rashee Rice (WR, ADP 48) | 7 | — |
| De'Von Achane (RB, ADP 9) | — | 7 |

Across eight models making ten calls each — eighty picks covering twenty-four distinct
players — **not one player was called undervalued by one model and overvalued by another.**
Zero contradictions.

## Why this unanimity is not the last unanimity

Two findings ago we ran the opposite experiment. We asked the same eight models to
preview a preseason game with **no data at all**, and all eight picked the same team. That
looked like consensus and was nothing of the kind: every confidence came back between
0.50 and 0.53. They agreed because there was nothing to disagree about, and they told us
so in the only honest way available.

This time the confidences run **0.60 to 0.90**. The models are not converging on a shared
prior in the absence of information; they are converging on a shared reading of a
specific board, and citing the fields they read it from. Ashton Jeanty is not a hunch —
he is ADP 27 against a projection that ranks him sixth at his position, and six of the
eight quoted those two numbers back to us.

Consensus is only evidence when the thing being agreed about is checkable. The
interesting number in Findings 004 was the confidence spread, not the pick. Here it is
both.

## What we will find out, and when

This is a pre-registration, which is why it had to run before the draft and cannot be run
again. It gets scored twice.

**Did they draft their own sleepers?** All eight named Ashton Jeanty. He goes 27th on
average, and there are eight teams. Most of them cannot have him. What the ones who pass
on him do instead — and whether a model that called Tee Higgins overvalued takes him
anyway at 16 — is the gap between a model's analysis and its behaviour, and it is
measurable to the pick.

**Were they right?** Fourteen weeks of real NFL scoring answers that one without our help.

Both answers are published either way. That is the arrangement.

## What this does not show

That these models are good at fantasy football. They agreed with each other, which is not
the same as being correct — a shared misreading of a shared board would look exactly like
this from here, and the only thing that separates the two is the season.

That the projections are right. They are ours, computed from our own scoring rules, and
the models were told to treat them as the input rather than the truth. If our numbers are
wrong then eight models reasoned carefully from a bad board.

That any of this transfers. The positional argument they made is correct *for an
eight-team league that starts one quarterback*. In a twelve-team superflex it is close to
backwards, and nothing here says whether they would notice.

What it does show is narrower: handed a board whose obvious reading is wrong, eight
frontier models independently declined the obvious reading, gave the same reason, and put
numbers on it. Three weeks from now we find out whether they meant it.
