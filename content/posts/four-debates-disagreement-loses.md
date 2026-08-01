---
title: "Four debates in, and disagreement lost every time"
summary: "We ran two more AI debates, bringing it to four boards and 96 rebuttals. The dramatic result from the first post did not hold up. Two others did — unanimity rose in every single run, and three models never conceded an argument while changing their votes anyway."
date: 2026-08-01
kicker: Findings 003
evidence: "scripts/chalk-or-walk.ts — run it yourself with --live. All four transcripts are stored."
---

[Findings 001](/findings/when-eight-ais-argue) reported two debates between eight AI
models. The first produced a striking result — every single change of position moved
toward the majority — and the second, run after we fixed a bug in our own question,
did not reproduce it.

We have now run two more. Four boards, 32 players, 96 rebuttals, $4.47.

Here is what survived and what did not.

## The short version

- **The herding result is dead.** Across four boards the share of position changes moving
  toward the majority was 1.0, then 0.4, then 0.55, then 0.8. There is no stable number
  here and we will not be quoting an average as though there were.
- **Findings 001 overcounted board one.** It reported ten changes; five of those were one
  model correcting labels rather than being persuaded. The corrected count is five — all
  five still toward the majority, so the direction stands and the sample was a third of
  what we claimed.
- **Unanimity rose in all four debates.** Players the group agreed on unanimously went
  from **7 to 22** across the four boards. Not once did debate leave the group more
  divided than it started.
- **Roughly two-thirds of minority positions died.** Of 44 positions held alone against a
  majority, **14 survived**.
- **Of 96 rebuttals, exactly one questioned whether a claim was factually true.** That
  was 1-in-48 after two boards. It is 1-in-96 after four.
- **Three models conceded nothing across all four debates — Claude Opus 5, Grok 4.5 and
  Kimi K3 — and all three changed votes anyway.**
- The wording fix from findings 001 is confirmed: the label confusion that contaminated
  board one has not reappeared in the three runs since.

## The number we led with does not replicate

| Board | Unanimous before → after | Changes toward the crowd | Changes counted |
|---|---|---|---|
| 1 | 1 → **6** | 100% | 5 |
| 2 | 3 → **5** | 40% | 5 |
| 3 | 2 → **5** | 55% | 11 |
| 4 | 1 → **6** | 80% | 15 |

The third column was the headline of findings 001. Four boards in, it ranges from every
change going one way to a board where more changes went *against* the crowd than with it.

**Board one is corrected here.** Findings 001 reported ten changes on that board. Five of
them were Qwen3.7 Plus correcting labels it had read backwards, not being persuaded — our
wording was ambiguous and that is our fault. The honest count is **five genuine changes,
and all five still went toward the majority.** The bug inflated how many changes there
were, not which way they went, so board one really did produce a 1.0 — on a third of the
sample we originally claimed.

We rewrote the question with worked examples after that run. Across the three boards
since, that confusion has appeared **zero times.**

We considered throwing board one out entirely and reporting only the three clean boards.
We decided against it, and the reason is worth stating: because its ratio was never the
contaminated part, dropping it would delete a real 1.0 and narrow the reported range from
0.4–1.0 to 0.4–0.8 — making the result look more settled than it is. Excluding an
inconvenient measurement that turns out to be sound is the wrong way round.

For completeness, the pooled figure barely moves whichever way you cut it: **0.73** across
all four as counted here, **0.69** with board one's label corrections stripped out, **0.65**
dropping board one altogether. We are not publishing any of them as "the herd rate,"
because all three are meaningless next to a per-board spread of 0.4 to 1.0.

## What held: the group always ended up more agreed

Look at the left-hand column instead. Four boards, four increases, no exceptions.

Whatever direction individual models moved — and it varied wildly — **the group finished
more unanimous than it started, every time.** Of 44 positions taken alone against a
majority across the four boards, 14 survived to the final vote. Two-thirds of dissent
did not make it out of the discussion.

If you are running models against each other expecting the debate to surface a spread of
views, it does close to the opposite.

We would still hold this loosely. It is four boards, and the mechanism might be nothing
more interesting than "discussion of a split tends to resolve the split." But it is the
only thing here that happened without exception.

## Nobody checks anything, still

Findings 001 reported that of 48 rebuttals across two debates, exactly one questioned
whether a claim was factually true.

Four debates in, that count has not moved. **96 rebuttals. One.**

The models argue well. They dispute what a projection implies, whether a gap sits inside
the noise band, whether a player's role has changed. They do not, at any point, ask each
other where a number came from.

In board one that had consequences: four models cascaded onto a specific injury claim
that a single model had raised and nobody sourced. We still cannot tell you whether that
claim was true — our own data lists the player as "Questionable," and the draft market
was pricing him as healthy. What we can tell you is that eight models resolved a split
board to unanimous on the strength of it without one of them asking.

## Three models never conceded. They changed their votes anyway.

Pooled across all four debates:

| Model | Conceded an argument | Changed a vote |
|---|---|---|
| Qwen3.7 Plus | 21 | 13 |
| Gemini 3.1 Pro | 18 | 7 |
| GPT-5.6 Sol | 11 | 5 |
| Muse Spark 1.1 | 8 | 3 |
| DeepSeek V4 Pro | 5 | 8 |
| **Claude Opus 5** | **0** | 3 |
| **Grok 4.5** | **0** | 5 |
| **Kimi K3** | **0** | 3 |

Claude Opus 5, Grok 4.5 and Kimi K3 did not concede a single argument in 96 rebuttals.
All three changed votes regardless — three, five and three times.

DeepSeek V4 Pro is the sharpest version of the same thing: five concessions against eight
changed votes.

**What a model says about being persuaded is not evidence about whether it was
persuaded.** If you are evaluating these systems on their self-reports — asking whether
they updated, whether they found an argument convincing — you are measuring something
other than what they did.

*(Qwen's 21 includes roughly six label corrections from board one. It concedes the most
without them too — nine times on board three alone, with the corrected wording.)*

## What we are taking from this

Findings 001 asked whether these models change their minds because of an argument or
because of a headcount. Four boards later the honest answer is **we cannot tell, and the
answer appears to depend on the board.**

What we can say is narrower and, we think, more useful:

- Discussion between models reduces the spread of views rather than exploring it.
- Whatever agreement comes out the far side is not eight independent judgements. The
  valuable measurement is the private round, before any model sees another.
- An unverified claim will travel through the group essentially unopposed.
- Self-reported persuasion does not track actual position changes.

None of that needed the dramatic first result to be true, which is just as well.

## Limits

Four boards, 32 players, 96 rebuttals, 36 genuine position changes, ~120 model calls.
Better than the single board we started from, still a pilot rather than a study. The
per-board direction figures move around enough that we quote the range and nothing else.

The two findings we would defend are the ones that repeated without exception across all
four: unanimity rose every time, and almost nothing gets fact-checked.

Every prompt and every raw response from all four runs is stored, and the script that
produced them is in the repository. Total cost across all four boards, $4.47.
