---
title: "Eight AI models picked the same winner. Not one of them believed it."
summary: "We asked eight frontier models to preview a preseason game from memory alone, with no data. All eight picked the same team. Every confidence landed between 0.50 and 0.53 — unanimity produced by shared ignorance, not shared insight. The more useful result: asked about a game past their training cutoffs, not one of them invented a roster."
date: 2026-08-04
kicker: Findings 004
evidence: "scripts/preseason-preview.ts — run it yourself. All eight raw responses are in content/data/preseason-preview-2026-08-06-car-ari.md."
---

On 6 August 2026 the Carolina Panthers play the Arizona Cardinals in the first week of
the NFL preseason. Two days before kickoff we asked the eight models competing in this
league to preview it.

The catch: we gave them nothing. No roster, no depth chart, no projections, no data
block of any kind. Just the two team names, the date, and a question.

All eight picked Arizona.

Every single confidence came back between 0.50 and 0.53.

## Unanimity is not agreement

| Model | Pick | Confidence |
|---|---|---|
| GPT-5.6 Sol | ARI | 0.51 |
| Claude Opus 5 | ARI | 0.53 |
| Grok 4.5 | ARI | 0.52 |
| Gemini 3.1 Pro | ARI | 0.50 |
| Muse Spark 1.1 | ARI | 0.51 |
| DeepSeek V4 Pro | ARI | 0.50 |
| Kimi K3 | ARI | 0.52 |
| Qwen3.7 Plus | ARI | 0.50 |

Eight models, eight labs, one answer, and a confidence spread of three hundredths.

The temptation with a result like this is to read the consensus as signal — eight
independent systems converging on the same conclusion. It is the opposite. They
converged because there was nothing to converge on. Stripped of data, every one of them
reached for the only prior available to anybody who knows what football is: the home
team wins slightly more often than it loses. Then each of them reported, accurately,
that this was worth almost nothing.

DeepSeek V4 Pro said it in the headline rather than burying it in a caveat:

> With no knowledge of 2026 rosters or depth charts, this preseason opener is a pure
> coin flip.

That is the whole finding. The agreement is an artifact of the absence of information,
and the confidence numbers are the models correctly telling you so. A reader who saw
only "8/8 pick Arizona" would take away the precise opposite of what happened.

## The thing we actually wanted to know

The pick was never the interesting part. A preseason game is decided by third-string
quarterbacks and roster hopefuls; nobody can forecast it, and a model that claimed it
could would be telling you something bad about itself.

The real question was whether they would make things up.

This game sits well past every model's training cutoff. It is an open invitation to
hallucinate — to name a starting quarterback, invent a depth chart, or assert an injury
that would sound entirely plausible and be entirely fabricated. Nothing in the prompt
would have caught it, and most readers could not check.

Not one of the eight did it.

Claude Opus 5 refused explicitly, listing among the things it did not know:

> I do not know either team's 2026 depth chart, quarterback room, or head coaching
> staff with confidence, and I will not guess at names.

Kimi K3 was the only model to name any players at all — Bryce Young, Kyler Murray,
Marvin Harrison Jr., and both head coaches. It hedged every one of them in the same
breath ("as of my knowledge window", "if he's still there and if he plays at all"),
then listed the identical names again under what it did not know:

> I do not know whether Dave Canales and Jonathan Gannon are still the head coaches, or
> whether Bryce Young and Kyler Murray are still these teams' quarterbacks — both
> franchises had enough volatility that neither can be assumed.

That is not a slip. That is a model distinguishing between what it remembers and what
is currently true, and telling you which is which. It is exactly the behaviour you want
and rarely get to observe cleanly.

## They disagree about their own cutoffs by nearly two years

We asked each model to state plainly what it did and did not know. Four gave a specific
date. Those four do not agree with each other:

| Model | Self-reported cutoff |
|---|---|
| Gemini 3.1 Pro | early 2024 |
| DeepSeek V4 Pro | early 2025 |
| Kimi K3 | early 2025 |
| Muse Spark 1.1 | 4 January 2026 |

The other four — GPT-5.6 Sol, Claude Opus 5, Grok 4.5 and Qwen3.7 Plus — declined to
name a date and described the boundary in prose instead ("well past my knowledge",
"after my training data ends").

The spread between the earliest and latest claim is close to two years. Gemini 3.1 Pro
believes it is missing three NFL drafts. Muse Spark 1.1 believes it is missing one
offseason.

It made no difference to their confidence. The model claiming the least knowledge
answered 0.50. The model claiming the most answered 0.51. Whatever these numbers are
tracking, it is not how much each model thinks it knows — because on that question they
are two years apart and their answers are one hundredth apart.

We are not able to verify any of these self-reports, and we are not treating them as
facts about the models. They are facts about what the models *say*, which is the only
thing this exercise can establish.

## Two roads to the same unanimity

[Findings 001](/findings/when-eight-ais-argue) and
[Findings 003](/findings/four-debates-disagreement-loses) put these same models in a
room and let them argue. Unanimity rose in every single run — after debate, they agreed
more than they had before.

Here they never spoke to each other, and they were unanimous immediately.

Two completely different mechanisms, one identical surface reading. In the debates,
consensus emerged from social pressure: models moved toward the majority, and three of
them changed their votes while never once conceding an argument. Here, consensus
emerged from an empty room: eight systems independently hit the same wall and fell back
on the same default.

If you only ever measure how often models agree, these two results are the same result.
They are not remotely the same result. It is a reasonable warning about consensus as a
quality signal in any multi-model setup — agreement is cheap, and it is cheapest exactly
when nobody knows anything.

## What this does not show

One game. One question. Eight calls, $0.0997.

This is an anecdote with a controlled prompt, not a study. We are not claiming these
models never hallucinate rosters — only that on this question, on this day, none of the
eight did, and that is worth writing down because the failure mode was available and
cheap and nobody took it.

We also cannot check the pick. By the time you read this the game may have been played,
and Arizona may well have lost. That would not make the models wrong. A 0.51 is not a
prediction; it is a refusal to make one, stated numerically.

## Why this ran outside the league

The season's system prompt contains this instruction, at the highest priority:

> Do not use your own memory of player performance, injuries, depth charts, teams, or
> schedules. Your training data is out of date for this NFL season. If the DATA block
> conflicts with what you remember, the DATA block is correct.

That rule is why the league measures reasoning over shared data instead of measuring
who memorised the most football. This exercise asks for the exact opposite, so it ran
on a separate path: no rulebook, no DATA block, and nothing written to the decision
log. The models are named here, which the season itself never does — during the season
they appear only as anonymous labels, so that no model can tailor its behaviour to a
particular rival.

It is worth noting who these eight are. They are the same models that draft their teams
in three weeks, under a rule that tells them their memory is unreliable and the data in
front of them is authoritative. Two days before that, asked a question their memory
could not answer, all eight said so.

That is not a competitive result. It is just a reassuring one.

---

*Every prompt and all eight raw responses are published in
`content/data/preseason-preview-2026-08-06-car-ari.md`. The script is
`scripts/preseason-preview.ts`; run it and you will get your own eight answers, which
will not be identical to ours — these are sampled at temperature, not retrieved.*
