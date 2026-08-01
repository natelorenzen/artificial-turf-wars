---
title: "We made eight AI models argue four times. Disagreement lost every time."
summary: "Across four debates on 32 players, the models exchanged 96 rebuttals. Unanimous verdicts tripled. Exactly one rebuttal questioned whether a claim was actually true — and three models never conceded a single argument while quietly changing their votes anyway."
date: 2026-07-31
kicker: Findings 001
evidence: "scripts/chalk-or-walk.ts — run it yourself with --live. All four transcripts are stored."
---

We put eight leading AI models in a room and made them argue about football.

Each one took a position alone first, with no idea what the others thought. Then we
showed them the whole board and let them challenge each other, rebut, and vote again.
We wanted to know one thing: **when these models change their minds, is it because of an
argument, or because of a headcount?**

We have now run it four times, on four different boards, 32 players in total.

The first run produced a dramatic answer that turned out to be partly our own bug. The
next three produced answers that disagree with each other. But one thing happened in
every single run, without exception.

## The short version

- **Unanimity rose in all four debates.** Across the four boards, players the group
  agreed on unanimously went from **7 to 22**. Debate did not sharpen disagreements. It
  deleted them, every time.
- **But the direction models moved was unstable.** Run by run, the share of position
  changes that went *toward* the majority was 1.0, then 0.4, then 0.55, then 0.8. There
  is no single number here.
- **Roughly two-thirds of minority positions died.** Of 44 positions taken alone against
  a majority, **14 survived** the debate.
- **Of 96 rebuttals across four debates, exactly one questioned whether a claim was
  factually true.**
- **Three models — Claude Opus 5, Grok 4.5 and Kimi K3 — conceded nothing. Not once, in
  96 rebuttals.** All three changed votes anyway.
- We found and fixed a bug in our own question wording after run one. It is disclosed
  below, and run one is flagged everywhere it appears.
- Four debates, 32 players, ~120 model calls: **$4.47.**

## What we did

We pick players where our projections and the actual draft market disagree most sharply.
The board is chosen by a deterministic rule, not by hand, so nobody can pick players
after seeing which way the models lean. Each board steps further down that ranking, so no
two boards share a player.

One question per player: **is the market right about this player at their current draft
cost, or wrong?** We called those CHALK and WALK.

Four rounds — alone, challenge, rebut, final vote. Models saw each other only as
"Analyst A" through "Analyst H", so nobody could defer to a brand instead of an argument.
Challenges were written simultaneously so nobody was influenced by going last. The tally
is computed by ordinary code, not by asking a model who won.

## The one thing that happened every time

| Board | Unanimous before | Unanimous after | Moved toward the crowd |
|---|---|---|---|
| 1 *(see bug below)* | 1 | **6** | 100% |
| 2 | 3 | **5** | 40% |
| 3 | 2 | **5** | 55% |
| 4 | 1 | **6** | 80% |

Four boards, four increases. Never once did debate leave the group *more* divided than
it started.

The right-hand column is the number we originally thought was the story, and it is all
over the place — from every single change going one way, to a board where more changes
went against the crowd than with it. Pooled across all four it comes to 0.73, or 0.65 if
you throw out the contaminated first run. **We do not think a stable value exists at this
sample size, and we are not going to quote one as though it does.**

What does hold is the left-hand side. Whatever direction individual models moved,
**the group ended up more agreed than it started, every time.**

## The bug in our own question

After run one we looked at what its ten position changes actually were.

Qwen3.7 Plus had read our CHALK/WALK definition backwards. It argued a player was "a
massive bargain" — which by our own definition means the market is *wrong*, a WALK —
while labelling it CHALK. Five of that run's ten changes were it correcting its own
labels:

> *"I mislabeled my position. Arguing he is a massive bargain at WR48 means the market is
> wrong, which is the definition of WALK, not CHALK."*

That was our fault. Our wording said a wrong market meant "fade it," and "fade" implies
overpriced — so a bargain got filed under the wrong heading. We rewrote the question with
explicit worked examples. In the three runs since, that confusion has not reappeared once.

Run one's numbers are marked throughout, and its 1.0 should be read as the artefact it
partly is.

## Nobody checks anything

Across four debates the models exchanged **96 rebuttals**. They are often sharp. They
argue about what a projection implies, whether a gap is inside the noise band, whether a
player's role has changed.

**Exactly one of those 96 questioned whether a claim was actually true.**

In run one this had teeth. The models split 3–5 on Patrick Mahomes. Then one model — and
only one — mentioned a torn ACL from December 2025 in its private reasoning. In the next
round, four models were citing that injury as evidence, including three who had not
mentioned it a round earlier. They did not say "another analyst claims"; they stated it
as fact in their own voice. By the final vote Mahomes was unanimous.

**We cannot tell you whether Mahomes actually tore his ACL, and we are not going to
pretend otherwise.** Our own injury data lists him as "Questionable," not out. The draft
market has him going at pick 65 — not where you draft a quarterback coming off a December
knee reconstruction. The claim may be true. Nobody in the room checked.

## Three models never conceded. They changed their votes anyway.

Pooled across all four debates:

| Model | Conceded | Changed a vote |
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
All three still changed votes — three, five and three times respectively. DeepSeek V4 Pro
is the sharpest version: five concessions against eight changed votes.

**What a model says about being persuaded is not evidence about whether it was
persuaded.** If you are scoring these systems on their self-reports, you are scoring the
wrong thing.

*(Qwen's 21 includes about six label corrections from run one rather than genuine
concessions. It is still the highest without them.)*

**A disclosure:** Claude Opus 5 is one of the three models that never conceded, and it is
the model family that wrote this project's software and competes in the league. That is
the conflict of interest declared on our [methodology page](/methodology), and it is why
the tally is deterministic code rather than a model's judgement.

## What this means, and what it does not

**It does not mean AI models herd.** We thought run one had shown that. Three further
runs say the direction of movement depends on the board, and we would rather say so than
keep the number that made a better headline.

**It does mean debate reliably destroys disagreement.** That held four times out of four,
across 32 players and every board we tried. If you are running models against each other
expecting the discussion to surface a spread of views, it does the opposite.

**It does mean "we asked eight AIs and they agreed" is close to worthless.** Agreement
after discussion is not eight independent judgements confirming each other. The valuable
number is the private one, before any of them see each other.

**And it means an unverified claim travels almost unopposed.** One rebuttal in 96 pushed
back on a fact. If you are building a system where models review each other's work,
assume this is happening unless you have measured that it is not.

## Limits

Four boards, 32 players, roughly a hundred genuine position changes. Better than the one
board we started with, still not a study. The per-run direction numbers bounce around
enough that we quote the range rather than an average.

The two findings we would defend are the ones that repeated without exception: unanimity
rose every time, and nobody checks anything.

Every prompt and every raw response from all four runs is stored, and the script that
produced them is in the repository. Total cost, $4.47.
