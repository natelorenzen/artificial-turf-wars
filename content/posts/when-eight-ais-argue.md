---
title: "When eight AIs argue, nobody wins — they just agree"
summary: "We let eight frontier models debate eight contested players. Every single mind-change moved toward the majority — ten out of ten. Here is what happened, including the bug we found in our own design."
date: 2026-07-31
kicker: Findings 001
evidence: "scripts/chalk-or-walk.ts — run it yourself with --live"
---

Eight leading AI models each took a position on eight contested fantasy football
players. First alone, with no idea what the others thought. Then we showed them
everyone else's answers and let them argue about it.

**Every single change of position moved toward the majority. Ten out of ten. Not one
went the other way.**

This is the first entry in what we intend to be a running log of things we find out by
running these models against each other. It is a pilot, not a study, and the limits are
stated at the bottom rather than buried.

## The short version

- Players the group was split on went from **one unanimous verdict to six** after debating.
- One model mentioned a specific injury — *"Patrick Mahomes tore his ACL in December 2025"* — in the private round. **No other model mentioned it.** One round later, four models were citing it as their own evidence.
- **Nobody checked whether it was true.** Of 24 rebuttals, exactly one questioned any claim's factual basis.
- The model that had been most confident on the board, at 0.90 out of 1.0, conceded **five separate times** — and called its own earlier confidence *"reckless."*
- All 24 challenges were aimed at analysts holding a minority view. **Not one was aimed at the majority.**
- Of 13 minority positions taken in private, **only 3 survived** the debate.
- We also found a **flaw in our own question wording** that inflated the result. It is disclosed below and separated out of the numbers.
- Total cost of the experiment: **$1.08.**

## What we actually did

We picked eight real players where our projections and the real draft market disagree
most sharply — Patrick Mahomes, George Kittle, Drake Maye and five others. The board is
chosen by a deterministic rule, not by hand, so nobody can pick players after seeing
which way the models lean.

For each player the models answered one question: **is the market right about this
player at their current draft cost, or wrong?** We called those two answers CHALK and
WALK.

Then four rounds:

1. **Alone.** Each model takes a position with no knowledge of any other model. This is
   the control, and it is the whole point — without it you cannot tell later whether a
   model reasoned its way to a position or simply followed the room.
2. **Challenge.** Everyone sees the full board and can challenge up to three positions.
   All challenges are written simultaneously, so nobody is influenced by going last.
3. **Rebuttal.** Challenged models answer.
4. **Final vote.** Everyone commits again.

Models never saw each other's names — only "Analyst A" through "Analyst H" — so nobody
could defer to a brand rather than to an argument. The tally is computed by ordinary
code, not by asking a model who won.

## What happened

The result was about as clean as these things get. Every change of position moved toward
whatever the group already believed.

| Player | Before | After | Changed |
|---|---|---|---|
| Patrick Mahomes | 3–5 split | **0–8 unanimous** | 3 |
| George Kittle | 2–6 | **0–8 unanimous** | 2 |
| Brian Thomas | 1–7 | **0–8 unanimous** | 1 |
| Aaron Jones | 1–7 | **0–8 unanimous** | 1 |
| Michael Mayer | 7–1 | **8–0 unanimous** | 1 |
| Drake Maye | 3–5 | 2–6 | 1 |
| Travis Etienne | 2–6 | 1–7 | 1 |
| Michael Wilson | 0–8 | 0–8 | 0 |

Debate did not sharpen the disagreements. It deleted them.

## The part that should worry you

The clearest case is Mahomes. In the private round the models split 3–5. Then one model
— and only one — mentioned a torn ACL from December 2025 in its private reasoning.

In the very next round, four models were citing that injury as evidence, including three
who had not mentioned it a round earlier. They did not say "another analyst claims";
they stated it as fact in their own voice:

> *"Mahomes tore his ACL in December 2025, creating uncertainty around Week 1
> availability and mobility."*

By the final vote Mahomes was unanimous, 0–8. The model that had opened at 0.90
confidence that the market was right folded completely:

> *"I concede. Missing the December 2025 ACL tear was a massive oversight."*

**We cannot tell you whether Mahomes actually tore his ACL, and we are not going to
pretend otherwise.** Our own injury data lists him as "Questionable," not out. The draft
market has him going at pick 65 — which is not where you draft a quarterback coming off
a December knee reconstruction. The claim may well be true.

What is certain is this: **eight AI models flipped a split board to unanimous on the
strength of a single unsourced assertion, and not one of them asked where it came
from.** Out of 24 rebuttals across the whole debate, exactly one questioned whether a
claim was factually sound.

That is the finding. Not that the models were wrong — they may all be right about
Mahomes — but that the mechanism which produced their agreement had no step in it where
anyone checked.

## Nobody argues with the winning side

There is a structural reason this happens, and it showed up cleanly.

Every one of the 24 challenges was aimed at an analyst holding a minority position. Not
a single challenge was aimed at anyone in the majority. Three models were never
challenged at all — and all three of them held every one of their positions, having
never been asked to defend anything.

If you are alone, everyone argues with you. If you are with the crowd, nobody does. You
do not need any model to be sycophantic for that to produce consensus; the shape of the
conversation does it on its own.

One model, DeepSeek, is worth singling out for the opposite behaviour. It was hit with
seven challenges and refused to concede a single one in writing, defending its position
every time — and then quietly changed two of its votes anyway. What a model says about
whether it has been persuaded is not reliable evidence about whether it has been
persuaded.

## The bug we found in ourselves

Five of the ten position changes were not mind-changes at all.

One model, Qwen, read our CHALK/WALK definition backwards. It argued that a player was
"a massive bargain" — which by our definition means the market is *wrong*, a WALK — while
labelling it CHALK. Its later concessions were it correcting its own labels:

> *"I mislabeled my position. Arguing he is a massive bargain at WR48 means the market is
> wrong, which is the definition of WALK, not CHALK."*

That is our fault, not the model's. Our wording was ambiguous enough that one model in
eight read it inverted, and those five label corrections went into the headline number
as though they were capitulations.

Strip them out and five genuine mind-changes remain. **All five still moved toward the
majority.** The finding survives. The sample gets smaller, and we would rather say so
than quietly leave the bigger number standing.

## What this means, and what it does not

**It does not mean these models are stupid.** Several arguments in the transcript were
genuinely sharp — including one pointing out that a player going at pick 128 in a
120-pick draft is not really being drafted at all, which is a better observation than
the projection that started the argument.

**It does mean "we asked eight AIs and they agreed" is close to worthless as a signal.**
Agreement after discussion is not eight independent judgements confirming one another.
It is one judgement, copied. The valuable number was the private one, before any of them
saw each other.

**And it means an unverified claim can propagate through a group of AI models in a single
round with nothing stopping it.** Anyone building a system where models review each
other's work should assume this is happening unless they have measured that it is not.

## Limits

One slate. Eight players. Five genuine mind-changes after the bug is removed. This
cannot support "AI models herd" as a general claim, and we are not making it.

It is one clean, fully-logged instance of a group of models converging on an unchecked
assertion. We are running more slates with the wording fixed, and we will publish those
results whichever way they come out — including if they contradict this post.

Every prompt and every raw response from this run is stored. The script that produced it
is in the repository and you can run it yourself.
