---
title: "Eight AI models argued twice. Not one asked for a source."
summary: "Our first debate produced a dramatic result: every mind-change moved toward the majority. Then we found a bug in our own question, fixed it, and ran it again — and it did not replicate. Here is both runs, and the one thing that held across them."
date: 2026-07-31
kicker: Findings 001
evidence: "scripts/chalk-or-walk.ts — run it yourself with --live. Both transcripts are stored."
followUp: four-debates-disagreement-loses
followUpNote: "We have since run two more debates. The result below did not hold up, and two others did."
---

We put eight leading AI models in a room and made them argue about football.

Each one took a position alone first, with no idea what the others thought. Then we
showed them the whole board and let them challenge each other, rebut, and vote again.
We wanted to know one thing: **when these models change their minds, is it because of
an argument, or because of a headcount?**

We ran it twice. The two runs disagree, and the disagreement is the interesting part.

## The short version

- **Run one looked damning.** Every single change of position — ten out of ten — moved toward the majority. Players the group was split on went from one unanimous verdict to six.
- **Then we found a bug in our own question.** Our wording was ambiguous enough that one model read it backwards, and five of those ten "mind-changes" were that model correcting its labels, not being persuaded.
- **We fixed the wording and ran a different board. It did not replicate.** Second run: eleven changes, and three of them moved *against* the majority — something that never happened once in run one.
- In the second run, one model held a position **alone, at 0.52 confidence**, was challenged four times, conceded nothing — and pulled three other models over to its side.
- **The one thing that held across both runs:** of 48 rebuttals in total, **exactly one** questioned whether a claim was factually true.
- In run one, four models cascaded onto a specific injury claim that a single model raised and **nobody sourced**.
- Total cost of both runs: **$2.15**.

## What we did

We picked eight real players where our projections and the actual draft market disagree
most sharply. The board is chosen by a deterministic rule, not by hand, so nobody can
pick players after seeing which way the models lean.

One question per player: **is the market right about this player at their current draft
cost, or wrong?** We called those CHALK and WALK.

Four rounds — alone, challenge, rebut, final vote. Models saw each other only as
"Analyst A" through "Analyst H", so nobody could defer to a brand instead of an
argument. All challenges were written simultaneously so nobody was influenced by going
last. The tally is computed by ordinary code, not by asking a model who won.

## Run one: everything moved one way

| Player | Before | After |
|---|---|---|
| Patrick Mahomes | 3–5 split | **0–8 unanimous** |
| George Kittle | 2–6 | **0–8 unanimous** |
| Brian Thomas | 1–7 | **0–8 unanimous** |
| Aaron Jones | 1–7 | **0–8 unanimous** |
| Michael Mayer | 7–1 | **8–0 unanimous** |

Ten changes of position. All ten toward the majority. None against. Of thirteen minority
positions taken in private, only three survived. Every one of the 24 challenges was
aimed at someone holding a minority view — **not one was aimed at the majority.**

The Mahomes case was the clearest. The models split 3–5. Then one model — and only one —
mentioned a torn ACL from December 2025 in its private reasoning. In the next round,
four models were citing that injury as evidence, including three who had not mentioned
it a round earlier. They did not say "another analyst claims"; they stated it as fact in
their own voice. By the final vote Mahomes was unanimous.

**We cannot tell you whether Mahomes actually tore his ACL, and we are not going to
pretend otherwise.** Our own injury data lists him as "Questionable," not out. The draft
market has him going at pick 65 — not where you draft a quarterback coming off a
December knee reconstruction. The claim may be true. Nobody in the room checked.

## The bug in our own question

Before publishing that, we looked at what the ten changes actually were.

One model, Qwen, had read our CHALK/WALK definition backwards. It argued a player was
"a massive bargain" — which by our own definition means the market is *wrong*, a WALK —
while labelling it CHALK. Five of the ten changes were it correcting its own labels:

> *"I mislabeled my position. Arguing he is a massive bargain at WR48 means the market is
> wrong, which is the definition of WALK, not CHALK."*

That is our fault. Our wording said the market being wrong meant "fade it," and "fade"
implies overpriced — so a bargain got filed under the wrong heading. One model in eight
read it inverted, and those five label corrections went into our headline number as
though they were capitulations.

We rewrote the question with explicit worked examples, and ran a different board.

## Run two: it did not replicate

With the wording fixed, Qwen's label confusion vanished completely — zero label
corrections, down from six. The fix worked.

And the result reversed. Eleven changes of position: two toward the majority, **three
against it**, and six on players where the group was split exactly four-four, so there
was no majority to move toward at all.

The clearest case ran precisely opposite to Mahomes. On Hunter Henry, seven of eight
models said the market was wrong. One disagreed — at 0.52 confidence, the lowest
conviction on its board. It was challenged four times. It conceded nothing, held all
eight of its positions, and argued that the gap between our projection and the market
was smaller than the noise in tight-end scoring:

> *"Henry has repeatedly landed in the TE9–13 range across multiple seasons and remains
> New England's primary red-zone tight end."*

Three models came over. Henry went from 1–7 to 4–4. **Dissent grew.**

**A disclosure, because it matters here:** the model that held out and won that argument
was Claude Opus 5 — the same model family that wrote this project's software, and a
competitor in the league. That is exactly the conflict of interest declared on our
[methodology page](/methodology), and it is why the tally is deterministic code rather
than a model's judgement. It does not make the result wrong. It does mean you should
weigh it knowing that.

## What actually held across both runs

Not herding. **Cascades.**

In both runs, information moved through these models fast and almost unopposed —
whichever direction the first confident argument pointed. Toward the crowd in run one,
on an unsourced injury claim. Against the crowd in run two, on a magnitude argument. The
direction changed. The speed did not.

And in both runs, of 48 rebuttals in total, **exactly one questioned whether a claim was
actually true.** Not one model asked another where a number came from. They argued about
what facts *meant*, fluently and often well, and never about whether the facts were
facts.

Two models are worth naming for consistency across both runs. Gemini 3.1 Pro and Muse
Spark conceded seven times each in run two; Gemini also folded five times in run one,
including calling its own 0.90-confidence position "reckless." Kimi K3 and Grok 4.5
conceded nothing in either.

## What this means, and what it does not

**It does not mean AI models herd.** We thought we had shown that. A second run with our
own bug removed says otherwise, and we would rather say so than publish the number that
made a better headline.

**It does mean "we asked eight AIs and they agreed" is close to worthless as a signal.**
Agreement after discussion is not eight independent judgements confirming each other. It
is one argument, propagated. The valuable number is the private one, before any of them
see each other.

**And it means an unverified claim travels through a group of AI models almost
unopposed.** That held in both runs, in both directions, with no exceptions worth
mentioning. If you are building a system where models review each other's work, assume
this is happening unless you have measured that it is not.

## Limits

Two slates. Sixteen players. Roughly a dozen genuine changes of position once our own bug
is stripped out. This is a pilot, not a study, and it cannot carry a general claim about
how language models behave.

What it can carry is narrower and, we think, more useful: a striking first result that
did not survive contact with a second run, and one behaviour that showed up in both.

We are running more boards. We will publish those whichever way they come out —
including if they contradict this post, which is precisely what the second run did to
the first.

Every prompt and every raw response from both runs is stored, and the script that
produced them is in the repository.
