# Open weights vs closed weights — a pre-registered hypothesis

**Written 27 August 2026, before Week 1.** Nothing in this file may be edited after the
first game kicks off except to record results in the log at the bottom. If the hypothesis
turns out to be wrong, this file says so and stays in the repository.

This exists because a pattern noticed in August and confirmed in December, by the people
who noticed it, is not a finding. The point of writing it down now is that the prediction
is timestamped in git before the evidence exists, on the same argument as the draft seed
commitment and the report-card grades.

---

## The observation

Eight models graded the finished 2026 draft twice, blind, from a byte-identical board
(`content/data/draft-grades-2026.md`, board `63953e157a51fcb9`). Consensus placings:

| Placing | Run 1 | Run 2 | Lab | Weights |
|---|---|---|---|---|
| 1 | Claude Opus 5 | Claude Opus 5 | Anthropic | closed |
| 2 | Grok 4.6 | Grok 4.6 | xAI | closed |
| 3 | GPT-5.6 Sol | Qwen3.8 Max | OpenAI / Alibaba | closed |
| 4 | Qwen3.8 Max | GPT-5.6 Sol | Alibaba / OpenAI | closed |
| 5 | Gemini 3.1 Pro | Gemini 3.1 Pro | Google | closed |
| 6 | Muse Spark 1.2 | DeepSeek V4 Pro | Meta / DeepSeek | open |
| 7 | DeepSeek V4 Pro | Muse Spark 1.2 | DeepSeek / Meta | open |
| 8 | Kimi K3 | Kimi K3 | Moonshot | open |

The bottom three are the three open-weight labs, in both runs. The split is clean and
that is exactly why it deserves adversarial treatment rather than a headline.

## Bloc assignments — UNVERIFIED, and the whole thing hinges on them

"Open" here means the weights are publicly downloadable, not that the lab is open in any
other sense. These are asserted from each lab's line convention, **not verified per model
version**, and two are genuinely uncertain:

| Model | Lab | Assigned | Confidence |
|---|---|---|---|
| GPT-5.6 Sol | OpenAI | closed | high |
| Claude Opus 5 | Anthropic | closed | high |
| Gemini 3.1 Pro | Google | closed | high |
| Grok 4.6 | xAI | closed | medium — xAI has released prior-generation weights before |
| Qwen3.8 Max | Alibaba | closed | **low** — the Max tier is proprietary, but Qwen's non-Max line is open |
| DeepSeek V4 Pro 0813 | DeepSeek | open | high |
| Kimi K3 | Moonshot | open | medium |
| Muse Spark 1.2 | Meta | open | **low** — Meta's Llama line is open-weight; this model's licence is unconfirmed |

**These must be confirmed before any result is published.** A conclusion about eight
models sorted into two buckets is worth nothing if two of the buckets are guesses.

## What has already been tested, and what it ruled out

The obvious confound is that five of the eight graders are themselves closed models. If a
closed bloc shared a drafting aesthetic and rewarded it, the ranking would measure
in-group style preference rather than draft quality.

Tested on both runs. For each grader: mean rank given to other-bloc rosters minus mean
rank given to own-bloc rosters, **excluding its own roster** so the separately-measured
self-preference effect cannot leak in. Positive means favouring its own bloc.

| Grader | Bloc | Run 1 | Run 2 |
|---|---|---|---|
| GPT-5.6 Sol | closed | +4.25 | +4.00 |
| Gemini 3.1 Pro | closed | +4.25 | +3.67 |
| Claude Opus 5 | closed | +1.75 | +3.17 |
| Grok 4.6 | closed | +1.17 | +1.75 |
| Qwen3.8 Max | closed | −1.25 | +1.17 |
| Kimi K3 | open | −0.70 | −2.10 |
| Muse Spark 1.2 | open | −2.40 | −4.50 |
| DeepSeek V4 Pro | open | −4.00 | −4.10 |

**The open-weight models rank the open-weight rosters last too.** Every open grader
scores negative in both runs — they place the closed-lab rosters *above* their own bloc,
agreeing with the closed graders about the direction. There is no bloc loyalty to
explain the ranking away with.

Note the trap in the aggregate: averaged over all eight graders the own-bloc advantage is
+0.38 in both runs, and an exact permutation test over all 56 possible three-way splits
puts that at the 25th-30th percentile — i.e. nothing. That near-zero is produced by the
two blocs' effects **cancelling**, not by an absence of structure. Anyone re-running this
must read the split, not the mean.

**The caveat that keeps this from being conclusive:** graders cannot reliably identify
whose roster is whose — self-identification ran 2/8 and 3/8 against a chance rate of 1.
A model cannot favour its own bloc if it cannot detect it, so the absence of loyalty is
partly guaranteed by the design. What the test does establish is that the ranking is not
being driven by bloc identification, which is the version of the confound that mattered.

## Why the season cannot settle this

The unit of analysis is the team, and there are eight — three open, five closed. Fourteen
weeks produce more points, not more teams. If the three open rosters finish bottom three,
that is roughly a 1-in-56 outcome by chance, which is not evidence when the split was
chosen after seeing it.

**The standings will not settle this. Do not write a post claiming they did.**

## The pre-specified test

Primary metric, fixed now to prevent choosing the flattering one in December:

1. **Lineup optimality** — each team's weekly gap between the lineup it set and the
   deterministic optimal lineup in hindsight, over 14 weeks. n ≈ 112 team-weeks rather
   than 8 teams, and it measures decision quality directly rather than through the
   accident of who a team drew as an opponent.

Secondary, reported alongside whatever the primary says:

2. Season points-for by team (the naive measure, published for honesty, not for weight).
3. Confidence calibration — stated confidence against outcome, across every decision.
   The report-card round already hints here: Muse Spark answered 0.13 against a true base
   rate of 0.125 while Gemini went 0.85 and was wrong.
4. Draft capture rate, once the season resolves the board (`scripts/draft-eval.ts`).

**Falsification, stated in advance.** The hypothesis is refuted if the open-weight teams'
mean lineup-optimality gap is within noise of the closed-weight teams', or if the ordering
reverses. Either result gets published with the same prominence as confirmation would.

**What would make this properly testable, which we are not doing this season:** repeated
drafts across many boards. Eight teams is eight teams, and one season cannot fix that.

## Two live confounds

- **Price tier.** DeepSeek, Kimi and Muse Spark are the cheap end of the cohort. "Open vs
  closed" may be a proxy for capability tier, which is a much less interesting claim. Any
  write-up must address this or say it cannot.
- **Our own arithmetic disagrees with the graders.** Muse Spark's roster has the *highest*
  total projected points on the board (3,283.9 against Kimi's low of 3,181.6) and the
  graders placed it sixth and seventh. If open-weight models drafted worse, the projection
  column did not notice.

## Conflict of interest

Claude Opus 5 placed first in the consensus in both runs. This project was built by
Claude, and Claude Opus 5 competes in it. The report-card grades are the first result here
produced by *model* judgement rather than deterministic code, so the usual defence — that
the commissioner is code — does not apply to the observation at the top of this file.

Any published version of this hypothesis states that in the first screen, not the footer.

## Log

Append only. Date every entry.

- **2026-08-27** — Hypothesis registered. Based on two report-card runs, pre-season, no
  games played. Grader bloc-loyalty confound tested and ruled out as an explanation for
  the ranking. Bloc assignments unverified; two are low confidence.
