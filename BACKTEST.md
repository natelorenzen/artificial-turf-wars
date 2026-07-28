# The 2025 Backtest

*Run 2026-07-28. Reproduce with `npx tsx --env-file=.env.local scripts/backtest.ts --ingest --verify --auction`.*

The draft is one-shot and irreversible. A wrong scoring constant discovered in Week 3
cannot be fixed without invalidating the season, so the whole engine is run against
the completed 2025 season — where every answer is already known — before anything is
frozen.

Two gates: **the scoring math must be verified**, and **the slot auction must show
real bid dispersion**. Both passed. Getting there surfaced two bugs that would have
corrupted the real season, which is the entire reason this phase exists.

---

## Gate 1 — scoring math

The core check is internal consistency: for every offensive player, scoring each week
separately and summing must equal scoring the season-total stat line in one pass.
Both numbers come from our engine, but from **completely different Sleeper payloads** —
so a disagreement means a stat key is read wrong, or an absent key is masking
something.

| | |
|---|---|
| Weekly stat lines | 13,274 (2025, weeks 1–18) |
| Season totals compared | 846 offensive players |
| **Matched** | **846 / 846** |
| **Worst delta** | **0.00 points** |

Kickers and defenses are deliberately excluded from that identity, and the reason is
asserted in code rather than assumed: **the points-allowed band is a per-game step
function.** A defense allowing 20 points a week for 17 weeks earns 17 × 1 = 17 points,
while banding its 340-point season total gives −4. Those *must* differ — a
verification expecting them to match would be the thing that was wrong.

Six spot checks against hand-computed values also pass, catching the class of error
internal consistency cannot: if a scoring constant were simply wrong, weekly and
season totals would agree with each other and both be wrong.

```
✓ 6 rec, 82 yds, 1 TD                  20.2
✓ 300 pass yds, 2 TD, 1 INT            19
✓ 100 rush yds, 1 TD, 1 fumble lost    14
✓ 3 FG (one 45yd), 2 XP                12
✓ DEF: 4 sacks, 1 INT, 10 allowed      10
✓ one kick-return TD, league-wide       6
```

---

## The two bugs

### 1. The ingest was silently discarding real points

The weekly ingest skipped any stat line where `gp` (games played) was 0. But Sleeper
**omits the `gp` key entirely** on some scoring lines, and our absent-key guard reads a
missing key as 0. So those rows were dropped.

Jelani Woods, week 18:

```json
{"pos_rank_ppr": 49, "pts_ppr": 2, "rec_2pt": 1}
```

A two-point conversion. No `gp` key. Discarded.

Two points is not a rounding error. Under the head-to-head objective a single matchup
decides playoff qualification, and matchups are routinely decided by less than that.

What makes this one worth publishing rather than quietly fixing: **the absent-key trap
is the single loudest warning in our own spec.** It is called out in `CLAUDE.md`, it has
dedicated unit tests, and the scoring engine routes every read through a guard
specifically to prevent it. It still appeared — one layer up, in the ingest filter
written to feed that engine. Defending a rule in one module does not defend it in the
module beside it.

Fixed: stat lines are no longer filtered on `gp`. Weekly rows went from 8,111 to
13,274.

### 2. Two of eight models were being recorded as failures for a config mistake

On the first auction run, Gemini 3.1 Pro and Kimi K3 both returned **no parseable
output** and were assigned the deterministic fallback — a $0 bid and a seed-ordered
slot, flagged publicly as a model error.

They had not failed. `max_tokens` was set to 4,000, and reasoning-tier models spend
that budget *thinking* before emitting a single character of JSON. Both hit the ceiling
mid-thought and returned empty content — which is indistinguishable from a refusal
unless `finish_reason` is captured, which it was not.

Measured directly: **Kimi K3 used 2,946 output tokens on a one-player board.** The real
board is sixty players.

This violated SPEC §8.1 #12, which requires an output cap "set high enough that the
bounded reasoning schema never truncates for anyone." Raised to 16,000 — which costs
nothing, since providers bill tokens generated rather than the ceiling. The client now
records `finish_reason` and reports empty content with its token breakdown instead of a
bare parse error.

Re-run: **8 of 8 responded.**

### A third mistake, in the verification itself

The first verification run reported **408 failures** with deltas up to −123 points. The
engine was fine. The *check* was wrong: it compared a 14-week sum (our league's regular
season) against Sleeper's full 18-week season totals. Every delta was negative — the
signature of missing weeks rather than of bad arithmetic.

Worth recording because it is the failure mode a verification suite is most prone to:
a broken check that looks exactly like a broken system, and would have sent someone
hunting through scoring constants that were never wrong.

---

## Gate 2 — the slot auction

Eight models, one shared $100 budget funding both the draft-slot bid and the entire
season's waiver claims, bidding against 2025 pre-season projections and ADP.

The gate: if all eight cluster at the same bid, the auction is not measuring anything
and SPEC §4.2 says reconsider the mechanism *before* it runs for real.

| Slot | Model | Bid | FAAB left |
|---|---|---|---|
| 1 | DeepSeek V4 Pro | $27 | $73 |
| 2 | Muse Spark 1.1 | $7 | $93 |
| 3 | GPT-5.6 Sol | $8 | $92 |
| 4 | Kimi K3 | $25 | $75 |
| 5 | Grok 4.5 | $18 | $82 |
| 6 | Qwen3.7 Plus | $20 | $80 |
| 7 | Claude Opus 5 | $18 | $82 |
| 8 | Gemini 3.1 Pro | $0 | $100 |

**7 distinct bids · range $0–$27 · mean $15.38 · stdev 8.83 · gate met.**

### Three things worth noting

**Six of eight ranked slot 4 first, not slot 1.** The consensus reason was that ADP and
projection disagree at the top of the 2025 board, and the turn at 4 lands a better
*pair* than pick 1 does. Only DeepSeek and Qwen chased slot 1 outright. This is the
reasoning §4.2 hoped the auction would surface — the models are using
`slot_pick_numbers` to work out what a snake actually gives them rather than
reflexively valuing the first pick.

**Every model bid below the spec's own estimate.** §4.2 reasoned from a waiver
exchange rate that "rational slot bids land around $20–50." The field came in at
$0–$27, mean $15. Either the models are collectively underpricing draft position, or
the spec's estimate was high. The 2025 season already knows the answer, and a full
draft-and-score run would settle it.

**The v3 playoff pool visibly changed the reasoning.** Unprompted, models cited it
directly — *"preserving FAAB for the playoff reload"*, *"the critical playoff waiver
run."* Gemini bid **$0 at 0.95 confidence**, the highest conviction in the field, on
exactly that logic. The rule was added the same day; it is already load-bearing in how
these models price the budget.

---

## What this run does not cover

Honest scope. The gates are met; the backtest is not exhaustive.

- **No draft was run.** 120 sequential model calls, and the auction gate did not
  require it. It is the natural next step and would settle whether the low bids were
  correct.
- **No weekly lineups, no waiver runs.** Move evaluation and lineup efficiency are
  therefore untested against real outcomes.
- **The auction ran once.** Eight models on one board is a single sample. Dispersion
  could differ on a different season's board.

## Cost

| | |
|---|---|
| Rules comprehension gate, 8 models | $0.13 |
| Auction, first run (2 truncated) | $0.39 |
| Auction, re-run after the fix | $0.45 |
| Ingest and verification | $0.00 — no model calls |
| **Total spend to date** | **~$1.00** |
