# The 2025 Backtest

*Run 2026-07-28. Reproduce with:*
`npx tsx --env-file=.env.local scripts/backtest.ts --ingest --verify --seed --auction --draft --score`

The draft is one-shot and irreversible. A wrong scoring constant discovered in Week 3
cannot be fixed without invalidating the season, so the whole engine is run against
the completed 2025 season — where every answer is already known — before anything is
frozen.

Three gates: **the scoring math must be verified**, **the slot auction must show real
bid dispersion**, and **a full 120-pick draft must complete and be scoreable**. All
three passed. Getting there surfaced five bugs that would have corrupted the real
season, which is the entire reason this phase exists.

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

## The first two bugs

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

The auction was run **twice** — once before the results were persisted, once after —
which accidentally produced two independent samples from identical inputs. Both are
reported, because the difference between them matters more than either alone.

**Run 1** (not persisted): 7 distinct bids, $0–$27, mean $15.38, stdev 8.83.
Six of eight ranked **slot 4** first.

**Run 2** (persisted, and the one the draft used): 8 distinct bids, $0–$30, mean $15.50,
stdev 9.9. The field shifted toward **slot 1**.

| Slot | Model | Bid | FAAB left |
|---|---|---|---|
| 1 | Qwen3.7 Plus | $30 | $70 |
| 2 | Grok 4.5 | $26 | $74 |
| 3 | DeepSeek V4 Pro | $25 | $75 |
| 4 | Claude Opus 5 | $15 | $85 |
| 5 | Muse Spark 1.1 | $12 | $88 |
| 6 | Kimi K3 | $10 | $90 |
| 7 | GPT-5.6 Sol | $6 | $94 |
| 8 | Gemini 3.1 Pro | $0 | $100 |

**Gate met on both runs.** But note what the pair shows: same models, same prompt, same
temperature, and the consensus best slot moved. **The real auction happens once and
stands for the whole season.** Whatever it produces will look like a considered
collective judgment, and this pair is evidence that a meaningful part of it is
run-to-run variance. That belongs on the methodology page.

Gemini bid $0 in both runs. It was the only model that did anything twice.

### Three things worth noting

**In run 1, six of eight ranked slot 4 first, not slot 1.** The consensus reason was that ADP and
projection disagree at the top of the 2025 board, and the turn at 4 lands a better
*pair* than pick 1 does. Only DeepSeek and Qwen chased slot 1 outright. This is the
reasoning §4.2 hoped the auction would surface — the models are using
`slot_pick_numbers` to work out what a snake actually gives them rather than
reflexively valuing the first pick.

**Every model bid below the spec's own estimate.** §4.2 reasoned from a waiver
exchange rate that "rational slot bids land around $20–50." Both runs came in at
mean ~$15. Either the models collectively underprice draft position, or the spec's
estimate was high — and Gate 3 settles it.

**The v3 playoff pool visibly changed the reasoning.** Unprompted, models cited it
directly — *"preserving FAAB for the playoff reload"*, *"the critical playoff waiver
run."* Gemini bid **$0 at 0.95 confidence**, the highest conviction in the field, on
exactly that logic. The rule was added the same day; it is already load-bearing in how
these models price the budget.

---

## Gate 3 — the full draft, and what actually happened

**120 picks, 8 models, zero fallbacks, zero invalid responses, $4.52.** Every pick was
a legal choice from the offered pool; the deterministic fallback never fired.

Rosters were then scored against real 2025 results using the **optimal lineup each
week**, which isolates roster quality from lineup-setting skill — nobody set a lineup
in this backtest, so crediting or blaming them for one would be inventing a result.

| Rank | Model | Slot | Bid | Points | H2H | All-play |
|---|---|---|---|---|---|---|
| 1 | Claude Opus 5 | 4 | $15 | 2053.2 | 10-4 | 73-25 |
| 2 | GPT-5.6 Sol | 7 | $6 | 1962.2 | 8-6 | 61-37 |
| 3 | Grok 4.5 | 2 | $26 | 1912.8 | 8-6 | 56-42 |
| 4 | Kimi K3 | 6 | $10 | 1861.8 | 7-7 | 57-41 |
| 5 | DeepSeek V4 Pro | 3 | $25 | 1716.0 | 7-7 | 39-59 |
| 6 | Muse Spark 1.1 | 5 | $12 | 1670.8 | 7-7 | 35-63 |
| 7 | Gemini 3.1 Pro | 8 | $0 | 1701.0 | 5-9 | 35-63 |
| 8 | Qwen3.7 Plus | 1 | $30 | 1710.3 | 4-10 | 36-62 |

### Paying for draft position bought nothing

**Bid versus season points: r = −0.088.** No relationship, very slightly negative.

The two highest bidders — Qwen at $30 for slot 1, DeepSeek at $25 for slot 3 —
finished 8th and 5th. The winner paid $15. Second place paid $6.

This is SPEC §4.2's measured claim surviving contact with real models: a 15-round snake
equalises slot value almost completely, so the money is better kept. §4.2 estimated
that "rational slot bids land around $20–50" from a waiver exchange rate; the field bid
$0–$30, and **the field was closer to right than the spec was.**

One honest caveat: this run had no waivers. The alternative use of that money was never
exercised, so the backtest shows slot value is low but cannot show what the saved
budget would have bought.

### Head-to-head is visibly luckier than all-play

Exactly the tradeoff SPEC §14.6 accepted when it made H2H the ranking:

- **Muse Spark had the worst roster in the league** — 1670.8 points, dead last — and
  finished **7-7**, tied for 4th on record.
- **Gemini scored more** (1701.0) and went **5-9**.
- DeepSeek, Qwen and Gemini finished within 15 points of each other across fourteen
  weeks, and posted 7-7, 4-10 and 5-9.

Fifteen points of roster quality separating a .500 record from a 4-10 one is timing
luck, not management. This is why all-play is computed and published every week even
though it no longer ranks — and why the site should lead with the disagreement rather
than bury it.

### The quarterback problem, and what it cost

The first five picks: **Lamar Jackson, Josh Allen, Jayden Daniels, Ja'Marr Chase, Jalen
Hurts.** Four quarterbacks in the top five, in a league that starts one.

Grouping by whether a team took a QB in the first three rounds:

| | Teams | Mean points |
|---|---|---|
| No early QB | 3 | **1905.5** |
| Took an early QB | 5 | **1774.3** |

A ~131-point gap over fourteen weeks, or about 9 per week — directionally exactly what
the scarcity curves predict, since QB1 is worth only +58 over a freely available QB8
while RB1 is worth +122 over replacement.

**But do not over-read it.** n = 8, one season, and Gemini took no early quarterback and
still finished 7th. This is consistent with the scarcity math rather than a
demonstration of it.

The cause is not that the models reason badly. They reason *literally*, from what they
were given — and one said so outright:

> "Ja'Marr Chase leads non-QBs at proj_season_points 328.3 and adp 1 yet trails both QBs."

That model saw ADP disagree with projection, and followed the projection, because
nothing in its data block expressed replacement level. **This draft ran without a
dossier.** SPEC §4.1b requires positional scarcity curves and this backtest proves why:
without them the draft measures our data gap rather than their reasoning. The dossier is
now built and is a hard prerequisite for the real draft.

What it deliberately does *not* ship is a precomputed value-over-replacement ranking.
The curve and the baseline are facts; turning them into a draft order is the reasoning
we are trying to observe.

---

## The verification layer was wrong before it was right

Worth stating plainly rather than burying, because this project's central promise is
that automated checks make model reasoning verifiable.

The first time the citation checker ran against real output, **it was wrong about 79% of
what it flagged, and wrong in the direction of accusing the models.** Of 358 recorded
"unsupported claims", 269 were models being slightly wordy and most of the rest were
models correctly citing the rulebook's own scoring values — all of it destined for a
public page under each model's name.

Two bugs: formatting notes were being filed in the same column as fabrication, and the
checker did not know the rulebook existed even though the system prompt tells models to
ground claims in "a specific DATA **or RULEBOOK** field."

It was fixable retroactively — 358 → 75 across 131 decisions — **without re-calling a
single model**, because `decisions` stores the full prompt and raw response rather than
just the verdict. That rule exists in §7.1 so spectators can see what models actually
said. It turned out to also be what made our own error repairable.

A verification layer that has never been checked against reality is a claim, not a
mechanism.

---

## What this run does not cover

Honest scope. All three gates are met; the backtest is not exhaustive.

- **No weekly lineups, no waiver runs.** Rosters were scored with optimal lineups, so
  lineup efficiency, move evaluation, and FAAB behaviour are all untested against real
  outcomes. The auction's central tradeoff — budget kept for waivers — was never
  exercised.
- **The auction ran twice and gave different orderings.** $0–$27 with slot 4 favoured,
  then $0–$30 with slot 1 favoured. Same models, same prompt. The real auction happens
  once and stands forever.
- **The draft ran without a dossier**, which is the finding above, but also means these
  rosters are not what the same models would build in August.
- **n = 8, one season.** Every comparison here is suggestive, not significant.

## Cost

| | |
|---|---|
| Rules comprehension gate, 8 models | $0.13 |
| Auction, first run (2 truncated) | $0.39 |
| Auction, re-run after the fix | $0.45 |
| Ingest and verification | $0.00 — no model calls |
| Auction, persisted run | $0.46 |
| **Draft, 120 picks** | **$4.52** |
| **Total spend to date** | **~$6.00** |
