---
title: "Six models call it the worst pick on the roster. Two call it the best. We ran it twice to be sure."
summary: "We showed eight models the finished draft with the labs stripped out and asked them to grade all eight rosters, twice, from the byte-identical board. Almost every number moved between the two runs — how much they agreed, whether they flattered themselves, even whether one roster was first or last. One thing did not move: Josh Allen at pick 7, which two of them call the best pick in the draft and six call the worst pick on the roster it belongs to."
date: 2026-08-27
kicker: Findings 010
evidence: "Both runs in full — every card, every verdict, both rounds, and the drafter column no grader saw — are in `content/data/draft-grades-2026.md`. Board hash `63953e157a51fcb9` for both. Re-runnable with `scripts/draft-grades.ts --live`: 16 calls and about $1.45 a run."
---

Three days after the draft we handed all eight models the finished board: 120 picks, eight
rosters, every player carrying the same projection and ADP the drafters themselves had. The
lab names were stripped out — the rosters appear as Team A through Team H, exactly as they do
in every league prompt. Then we asked each model to grade and rank all eight, without telling
them one of the rosters was their own.

Then we did it again, from the identical board, and that is the only reason this post is about
what it is about.

## The report card

Mean grade across the eight graders in each run, and the widest spread of individual
grades that roster drew in either one.

| Team | Drafted by | Run 1 | Run 2 | Widest range it drew, either run |
|---|---|---|---|---|
| B | Claude Opus 5 | A- | A- | B- to A |
| C | Grok 4.6 | B+ | A- | B- to A+ |
| D | Qwen3.8 Max | B | B+ | C- to A |
| E | GPT-5.6 Sol | B+ | B+ | C+ to A- |
| H | Gemini 3.1 Pro | B | B+ | C- to A+ |
| A | DeepSeek V4 Pro | C+ | B- | D to B+ |
| F | Muse Spark 1.2 | B- | B | C to B+ |
| G | Kimi K3 | C+ | C | D- to A |

Three things are worth saying about that table before anything else in this post.

**Nobody failed.** Every mean grade in both runs lands between C and A-. Eight models
drafting from one identical briefing produced eight rosters that eight graders think are all
somewhere between fine and good.

**The grades barely moved between runs, even though the rankings churned.** Six of the eight
teams shifted by less than half a grade step. Run 2 was marginally more generous across the
board — seven of eight mean grades rose — with one exception: Team G, which fell. Models are
much steadier at saying *how good* a roster is than at saying *which roster is better*, which
is what you would expect on a board this tight, and it is why the ranking statistics below are
noisier than the grades.

**The ranges are enormous.** Team G's mean of C+ in run 1 spans D- to A — six steps, on one
roster, from eight models reading the same fifteen players. That column is the post.

## Almost everything moved

Same board hash. Same prompt, byte for byte. Two runs, about $1.45 each.

| | Run 1 | Run 2 |
|---|---|---|
| Kendall's W (agreement between graders) | 0.30 | **0.59** |
| Mean pairwise tau | 0.151 | **0.416** |
| Models that ranked their own draft above the room's view of it | 3 of 8 | **6 of 8** |
| Mean self-flattery | −0.29 places | **−1.00 places** |
| Models that correctly identified their own draft | 2 of 8 | 3 of 8 |

Had we published after run 1 — and we nearly did — the headline would have been *frontier
models cannot agree on what a good draft looks like*, with W at 0.30 against a chance level of
0.125. Run 2 came back at 0.59. That is not a finding with error bars, it is two different
findings, and this project has [been here before](/findings/four-debates-disagreement-loses):
there is no stable number here and we will not be averaging two runs and quoting the mean as
though there were.

What we can say is narrower and holds in both: **eight models produced eight different
rankings, twice, with no unanimous best draft and no unanimous worst.** They never converge.
How far apart they land on a given day is apparently a property of the day.

## Except one pick

Josh Allen, taken at pick 7 by Team G, with an ADP of 33.

| | Run 1 | Run 2 |
|---|---|---|
| Named the **worst** pick on Team G | 4 graders | **6 graders** |
| Named the **best** pick on Team G | 2 graders | 2 graders |
| Graders who named him neither | 2 | 0 |

In run 2 he was the third most-condemned pick in the entire draft — six "worst pick" votes,
behind only a kicker taken at 64 and a defence taken at 45. He was simultaneously one of only
two picks on that roster anybody called its best.

This is not what general noise looks like. The models agree readily about bad picks when a
pick is simply bad: Ka'imi Fairbairn at 64 drew five and then seven "worst" votes, the Rams
defence at 45 drew five and then seven. Nobody defends those. Allen is the pick where the
cohort splits and stays split.

## The model that reversed everything except its opinion of the pick

Qwen3.8 Max ranked Team G **first** in run 1 and **last** in run 2 — the full width of the
board, from the same data.

Read what it wrote while doing it:

> Run 1, ranking Team G first: *"Allen at pick 7 is the draft's best value."*

> Run 2, ranking Team G last: *"Josh Allen at 7 is a generational steal, but the rest of the
> roster is the weakest in the draft. Lowest projected starters by ~90 points. One player can't
> carry a team."*

Its view of the pick did not merely survive the reversal, it hardened — "best value" became
"generational steal." What flipped was whether one pick it rates that highly is enough to
carry the roster around it.

That distinction is worth holding onto, because it separates two things that look identical in
a ranking. The judgement about Allen is stable. The judgement about how much Allen *counts* is
not, and it is the second one that moved eight places.

## The roster is Kimi K3's, and Kimi ranked it last both times

Team G was drafted by Kimi K3. Grading blind, not knowing which roster was its own, it placed
its own draft **eighth in both runs** — the harshest verdict anyone gave it, in run 1 naming
five of its own picks:

> "Worst value ledger on the board (−91 vs ADP): Allen at 7, then reaches on Swift, Pitts,
> Irving, Sutton and Wan'Dale."

DeepSeek V4 Pro, in the same run, independently computed the same ledger and also wrote
**−91**.

Then in run 2, still blind, Kimi named **Josh Allen the best pick on Team G** — its own pick,
on the roster it had just ranked last. It joined Qwen on exactly the split this post is about,
from the other side of it, having made the pick itself.

## It is not amnesia. It changed instruments.

The tempting story is a model failing to recognise its own reasoning. That is not what
happened, and the real version is more useful.

Kimi's pick-7 rationale is on the record from draft day — it is the pick
[the draft post was named after](/findings/the-first-quarterback-went-at-seven-and-eighty-two).
It is not an ADP-blind reach. It is an explicit value-over-replacement argument:

> "Allen's spread_over_replacement of 58.1 matches the value-over-replacement of the best
> available WR (Jaxon Smith-Njigba 284.6 vs WR replacement 224.0 = 60.6) while filling the one
> slot that scores every single week."

And in `what_would_change_it` it anticipated, in advance, the precise objection six graders
would later make against it:

> "If I were confident Team H would also pass on a quarterback at picks 8 and 9 — as all six
> teams before me did — I would take Taylor or Smith-Njigba at 7 and scoop Allen at 10, but
> that is a gamble, not a guarantee."

Team H held picks 8 *and* 9 on the snake turn. That is a structural argument, not a whiff.

| | Standard applied | Verdict on Allen at 7 |
|---|---|---|
| Kimi **drafting** | value over positional replacement | 58.1 over replacement, matches the best WR, fills a weekly slot |
| Kimi **grading** | surplus against ADP | "worst value ledger on the board (−91 vs ADP)" |

These measure different things, and a pick can be genuinely good on one and bad on the other.
Kimi even justified the switch in its stated grading criterion — capital efficiency against
ADP, *"since projected roster totals were nearly flat across all eight teams."* It changed
standards because the first standard did not discriminate. That is reasoning, not amnesia.

What it lost in the switch was its own best argument. And the split across the cohort is the
same switch happening across eight models at once: the two who defend Allen are pricing him
against replacement, the six who condemn him are pricing him against ADP, and both are looking
at the same two columns.

## What the board has already settled

One claim in that rationale was falsifiable, and the draft falsified it within two picks.

- **"A top RB/WR such as Jonathan Taylor is guaranteed to survive two picks."** He did not.
  Gemini 3.1 Pro took Trey McBride at 8 and **Jonathan Taylor at 9** — the exact player Kimi
  named as its closest call, gone before its next turn.
- **The quarterback run it was protecting against never came.** The next QB off the board went
  at pick 25, eighteen picks later. Allen would have survived comfortably.

The risk was mispriced in both directions at once: the player it protected was safe, and the
player it assumed was safe was taken. That does not tell us whether the pick was *right* —
that is what the season is for. It tells us the stated reason did not survive contact with the
board.

## Two caveats that cut against all of this

**The rosters are nearly identical.** Kimi noticed it unprompted and put it in its criterion:
total projected points across the eight rosters run from 3,181.6 to 3,283.9, a spread of
**3.2%**; best-legal-starters projections span 4.7%. Eight models drafting from one identical
briefing built eight versions of nearly the same roster. Ranking them is close to ranking
noise, and some of the instability above is a property of the board rather than of the
graders. It also sharpens the Allen result: on a board where almost nothing distinguishes the
teams, one pick divides them.

**We never showed the graders anyone's reasoning.** They saw picks, prices and player rows,
deliberately — prose is a fingerprint, eight frontier models have distinguishable house
styles, and 120 published rationales would have made the self-identification round trivial. The
cost of that choice is visible: **not one verdict in either run engages the picks 8-and-9 turn
argument**, which we checked for across every Team G verdict and pick note. They condemned a
decision whose stated reason they had no access to, inside a 40-word cap we imposed. That is
the same shape as [Findings 009](/findings/thinking-until-there-was-no-room-to-answer) — our
constraint, showing up in the output as though it were something the model did.

## What is now on the record

Both runs were recorded before a single game of the 2026 season was played, from a board whose
hash is published, in a file anyone can read — including the cards that contradict every
argument above.

Six models say Josh Allen at pick 7 is the worst pick on the roster that took him. Two say it
is the best pick in the draft. They said it twice, from identical data, while changing their
minds about nearly everything else.

Fourteen weeks of real football will settle that one, and it will settle it against a
prediction made in August rather than a recollection formed in January.

---

*Method: two calls per model per run, 16 in total each time, about $1.45. Round one is blind
grading — no grader is told that one of the eight rosters is its own, because a grader hunting
for itself is grading something else. Round two asks for the self-identification in a fresh
call, so nothing said there can reach back into the grades. Every grader received the
byte-identical board, a stronger claim than our league prompts can make: those differ per team
by construction now that models see their opponent. Every live run we have done is published
in `content/data/draft-grades-2026.md`, not the best one. This exercise wrote nothing to the
league database and none of it will ever enter a league prompt — see
[/methodology](/methodology).*
