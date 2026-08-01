---
title: "Eight AI models priced the same thing. They said $0 to $30."
summary: "We gave eight frontier models $100 each and made them bid for draft position, knowing every dollar spent came out of their waiver budget for the whole season. The bids ranged from nothing to thirty dollars. Then we played the season out and found the thing was worth nothing."
date: 2026-08-01
kicker: Findings 002
evidence: "2025 rehearsal — every bid, every rationale and all 120 picks are on the draft board page."
---

Before the draft, each model got the same $100 and the same instruction: bid for your
pick in the draft order. Whatever you do not spend is your entire waiver budget for the
next fourteen weeks, plus the playoff auction at the end.

One shot, sealed bids, no negotiation. Highest bidder gets first pick.

**The eight bids were $30, $26, $25, $15, $12, $10, $6 and $0.**

Same rules. Same data. Same board. A 30-to-1 spread on what the identical thing was
worth.

*(This is the 2025 rehearsal — a dry run against a season whose results were already
known. Not the live league, and nobody won anything.)*

## The short version

- Eight models priced draft position from **$0 to $30** out of the same $100.
- **Half the cohort read the snake draft correctly and half did not.** Four ranked a *middle* slot as their first choice; four ranked slots in plain 1-2-3-4-5-6-7-8 order.
- One model bid **$0 while ranking the slot it would inevitably get as the worst on the board** — and did it at **0.95 confidence**, the highest on the board.
- Three models identified the same slot as best. Only one paid enough to get it.
- Then we played the season out. Correlation between what a model paid and what its roster scored: **r = −0.088.** Effectively zero, and pointing the wrong way.
- **The team that bought the first overall pick finished 6th of 8.**
- 120 picks, zero fallbacks, zero invalid responses, $4.99 of model spend.

## The disagreement was not about football

Every model saw the same projections. They agreed almost exactly on the players — Ja'Marr
Chase top of the board at 328.3 projected points, Bijan Robinson next at 308.1. Nobody
disputed the numbers.

They disagreed about **what draft position is worth**, and the split was structural.

**The spenders** treated it as buying the best player:

> *"Slot 1 yields the 1st overall pick, corresponding to ADP 1 Ja'Marr Chase with a
> proj_season_points of 328.3."* — the $30 bid

**The savers** treated it as buying almost nothing:

> *"The projection curve is nearly flat… only a ~26-point spread from pick 1 to pick 13,
> so no slot commands a premium."* — the $10 bid

Both are looking at the same table. One sees a 328.3 at the top and pays for it. The
other sees that the gap from pick 1 to pick 13 is 26 points across a whole season — under
two points a week — and declines.

## Half of them read the snake correctly

This is the part that separates the cohort, and it has a right answer.

In a snake draft, slot 1 picks 1st and then 16th. Slot 8 picks 8th and 9th, back to back.
The first pick is not the prize; **the pair is.**

Four models found this independently. They ranked a *middle* slot first, because in the
2025 data CeeDee Lamb was going at pick 13 with a 302.5 projection — near-elite value
sitting exactly where slot 4's second pick lands:

> *"Slot 4 is the sweet spot: at 4 the best projection left is very likely Bijan Robinson
> (308.1) or Saquon Barkley (302.5), and pick 13 sits exactly on Lamb's adp 13, a
> plausible 610-point projected pair… Slot 1 buys Ja'Marr Chase (328.3) but pick 16 falls
> past every one of the 15 named players, so the second pick is an unknown."*

The other four ranked the slots 1, 2, 3, 4, 5, 6, 7, 8 — earlier is better, straight down.
That is the intuitive answer and, on this board, the wrong one.

One model went further still and noticed that the last slot carries the best waiver
priority for the rest of the season, ranking slot 8 *ahead* of slots 1 and 2 for that
reason alone. Nobody else priced the second-order effect at all.

**A disclosure:** the reasoning quoted just above is Claude Opus 5's, which is the model
family that wrote this project's software and a competitor in the league. It is also, as
you will see, the model that won the rehearsal. That is the conflict of interest declared
on our [methodology page](/methodology), and it is why the auction is resolved by
deterministic code rather than by anyone's judgement. Weigh it accordingly.

## The most interesting bid was $0

One model produced this combination:

- It ranked slot 4 as clearly the best, at 610.6 combined projected points.
- It ranked slot 8 as **"the least desirable,"** at 498.9 — a gap of 112 points.
- It bid **$0**, which in a sealed auction guarantees the last slot.
- It recorded **0.95 confidence** — the highest of any model on the board.

It got slot 8. Its own analysis said that was the worst available outcome, and it walked
into it deliberately, reasoning that the full $100 of waiver money was worth more than
112 projected points:

> *"Preserving the full $100 budget ensures maximum bidding power when every player from
> the 4 eliminated teams is released into the free-agent pool in Week 15."*

That is a coherent argument. It is also a model knowingly accepting the outcome it had
just ranked last, at near-maximum stated confidence. Whether you read that as discipline
or as a failure to price its own analysis is the whole question.

Three models named slot 4 as their first choice. Only one of them bid enough to get it.
The other two — at $6 and $0 — were right about the analysis and wrong about the price,
which in a sealed auction is the same as being wrong.

## Then we played the season out

The rehearsal ran the full 2025 season against real results. So we can ask the only
question that matters: **did paying for draft position buy anything?**

| Slot | Paid | Season points | Finish |
|---|---|---|---|
| 4 | $15 | 2053.2 | **1st** |
| 7 | $6 | 1962.2 | 2nd |
| 2 | $26 | 1912.8 | 3rd |
| 6 | $10 | 1861.8 | 4th |
| 3 | $25 | 1716.0 | 5th |
| **1** | **$30** | **1710.3** | **6th** |
| 8 | $0 | 1701.0 | 7th |
| 5 | $12 | 1670.8 | 8th |

Correlation between dollars spent and points scored: **r = −0.088.**

That is nothing. Slightly worse than nothing. **The model that paid $30 for the first
overall pick finished sixth.** The model that paid $6 finished second. The two biggest
spenders came 5th and 6th.

Bidding nothing did not work either — the $0 team finished 7th. The honest reading is not
"saving was smart." It is that **the thing being auctioned had no measurable value, and
eight models spent between $0 and $30 finding that out.**

## What this means, and what it does not

**It does not mean draft position is worthless in general.** One eight-team league, one
season, eight data points. An r of −0.088 across eight teams is not a result you should
carry anywhere. A different projection board — one without a near-elite player sitting at
pick 13 — would likely produce a different answer.

**It does mean the cohort had no shared theory of value.** On the football, they agreed
almost perfectly. Asked what a structural advantage was *worth in dollars*, they ranged
across the entire available space. Pricing is a different skill from projecting, and this
cohort is far more consistent at the second than the first.

**And it means being right is not the same as acting on it.** Three models identified the
best slot. Two of them declined to pay for it and got slots they had ranked poorly. In an
auction, an unfunded correct opinion scores the same as a wrong one.

## Limits

This was the rehearsal, not the live season. It ran against 2025 results that already
existed, which is exactly why we ran it — the real draft is one-shot and irreversible,
and we wanted the engine to meet real data before it counted.

Eight teams is a small sample and one season is one season. The bid dispersion is the
robust finding here; the correlation is a curiosity with too few points behind it to lean
on.

All eight bids, all eight rationales and all 120 picks with reasoning are published on
the [draft board](/backtest/draft). The whole rehearsal cost $4.99 in model spend, with
zero fallbacks and zero invalid responses across 128 decisions.

The real auction runs in late August, with the same rules and eight models that have
never seen this post.
