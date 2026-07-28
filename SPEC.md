# GRIDIRON GAUNTLET — Reconciled Build Spec v2

> Supersedes `gridiron-gauntlet-spec.md` (v1, 5 models). Reconciled 2026-07-27 against
> verified Sleeper + OpenRouter data, `~/claude/STACK.md`, and `~/claude/LESSONS.md`.
> Changes from v1 are marked **[CHANGED]**, **[NEW]**, or **[OPEN]**.

**Tagline:** Eight AI models. One NFL fantasy season. Watch them think.

Eight frontier models each run one fantasy team with no human help. They draft, set a lineup
every week, and bid against each other on waivers. Real NFL results score them. Every prompt
and every raw response is published.

**The product is the reasoning, not the trophy.** All eight models see a byte-identical data
block, so every difference in what they do is attributable to the model itself. The site is
built to show that: where they agreed, where one broke from the field, what each said was
its hardest call, and — after the games — who was right.

**Framing (non-negotiable, stated on the site):** this is an exhibition, not a proof. One
season shares one set of NFL luck across all eight teams. The winner is the best manager of
*this* season, not the best possible manager.

---

## 0. What changed from v1, and why

| # | v1 | v2 | Reason |
|---|----|----|--------|
| 1 | 5 models | **8 models** | DeepSeek, Kimi, and Qwen added. See §2. |
| 2 | Muse Spark "may need a direct Meta adapter" | **No adapter needed** | Verified `meta/muse-spark-1.1` is live on OpenRouter. One key covers all 8. |
| 3 | React + Vite | **Next.js 16 App Router** | `LESSONS.md` rule: public pages that must rank → Next.js. We also need server-rendered OG tags for share cards and API routes for Vercel Cron. |
| 4 | "Flat JSON *or* Supabase" | **Supabase + JSON export to git** | Supabase is the queryable system of record; the git-committed export is the tamper-evident audit trail. |
| 5 | All-play 0-4 to 4-0 | **0-7 to 7-0** | 8 teams → 7 comparisons per week. |
| 6 | 60 draft picks | **120 draft picks** | 8 teams × 15 rounds. |
| 7 | ADP from player pool | **ADP from the week-1 projections endpoint** | Verified: the season-long endpoint returns `adp: null`. See §5.2. |
| 8 | "starting nine" contradiction | **Full Yahoo nine — resolved** | Yahoo's default nine includes K + DEF/ST; v1 excluded them and never updated the prose. See §3.1. |
| 9 | — | **[NEW] Pre-registered seed** | Hash published before the auction; now used only to break bid ties. See §8.3. |
| 10 | — | **[NEW] 2025 backtest dry run** | The draft is one-shot and irreversible. Rehearse the whole pipeline on the completed 2025 season first. See §9. |
| 11 | INT −2 | **INT −1** | Adopt Yahoo's documented default. See §3.2. |
| 12 | No 2-pt or return TD | **Both scored** | v1 omitted them; Yahoo scores both. See §3.2. |
| 13 | Tuesday scoring only | **Provisional Tue + final re-score Thu** | Yahoo applies stat corrections until the next week's first game. See §5.5. |
| 14 | — | **[NEW] Yahoo alignment matrix** | Explicit match/deviate table for the methodology page. See §11. |
| 15 | K and DEF/ST excluded | **Both included** | Reversed. Full Yahoo starting nine. See §3.1. |
| 16 | 12-man roster, 12 rounds | **15-man roster, 15 rounds** | Nine starters need six bench spots to survive byes. See §3.1. |
| 17 | 7 teams | **8 teams** | Even count → real H2H schedule, no byes. See below. |
| 18 | Waivers "later" | **FAAB waivers in v1** | Richest reasoning artifact in the project. See §4.5. |
| 19 | Reasoning capped at one sentence | **Structured reasoning schema** | One sentence per week cannot showcase reasoning. See §4.1a. |
| 20 | — | **[NEW] Move evaluation + calibration** | Measures *where* a model reasoned well, not just whether it won. See §6.2, §6.3. |
| 21 | — | **[NEW] Disagreement view** | Identical inputs make every difference attributable to the model. See §7.3. |
| 22 | Draft order randomized from a seed | **[NEW] Sealed-bid slot auction** | Slot becomes earned rather than drawn, paid from the same budget as waivers. Removes the §8.3 confound instead of disclosing it. See §4.2. |
| 23 | Only "respect the PPR format" | **[NEW] Full League Rulebook in every call** | Models were never told the objective or the exact scoring, and filled gaps from differing training priors — a real hidden bias. See §4.1. |
| 24 | — | **[NEW] Pre-season dossier, rules check, gameplan** | Equalizes preparation, verifies comprehension, and creates season-long accountability. See §4.1b. |
| 25 | Stateless calls | **[NEW] Bounded identical memory block** | Managers must remember their own plan, but unbounded history would break Grok's 500K window first. See §4.1b. |
| 26 | Byes "[OPEN], needs a source check" | **[RESOLVED] Derived from the schedule endpoint** | No bye field exists on players. Derived and validated: all 32 teams, one bye each. Week 11 has six; Week 14 has two. See §5.3. |
| 27 | "Optional four-team playoff, weeks 15–17" | **[NEW] Fully specified, Weeks 15–16** | Named no seeding, bracket, or scoring rule — unbuildable. We skip Week 17 because NFL starters rest. See §3.3. |
| 28 | Exact ties undefined | **[NEW] Half a win each in all-play** | The commissioner is deterministic; a tie needed a stated rule. See §6.1. |
| 29 | H2H schedule undefined | **[NEW] Circle method, seeded, pre-committed** | Generated and committed before the auction so results cannot shape the schedule. See §6.1. |
| 30 | Only malformed-JSON retries | **[NEW] §5.6 failure handling** | Provider outage, Sleeper downtime, missed week, and mid-season model deprecation all needed answers. |
| 31 | Draft roster legality undefined | **[NEW] Round-13 soft cap** | Nothing stopped a team from drafting no kicker and breaking every week. See §4.3. |
| 32 | Cron times given in ET | **[NEW] UTC + DST guard** | US DST ends 1 Nov 2026, mid-Week 9; a fixed UTC cron drifts an hour against kickoff. See §5.5. |
| 33 | Site pages scattered | **[NEW] §7.4 site map** | v1 had a public-site section; this rewrite lost it. The site is the product. |
| 34 | "Rational bids are 10–20%" | **[CORRECTED] ~$20–50** | Slot value was compared to roster value; the right comparison is to what FAAB buys. One good waiver add ≈ the whole slot advantage. See §4.2. |
| 35 | — | **[NEW] Budget must be shared, not split** | Use-it-or-lose-it auction money has no opportunity cost, so every model bids the cap and the auction collapses into randomness. See §4.2. |
| 36 | — | **[NEW] §12 design system** | Retro 16-bit broadcast direction. Mockup: `design/look-and-feel.html`. |
| 37 | "Auto-generated recap" | **[NEW] §7.5 weekly wrap with a voice** | Short post + full column, affectionate ribbing, written by a **non-competing** model against a deterministic facts packet with a number check. |
| 38 | — | **[NEW] §6.4 win probability** | Matchup odds, expected all-play record, playoff odds. Spectator-facing only — models never see them, or they'd be reasoning from our estimator. |
| 39 | — | **[NEW] §6.5 positional rankings** | Decomposes a team's result into *where* the manager succeeded, and checks the August gameplan against hard numbers. |

### Note on team count — **[RESOLVED: 8]**

Team count never changed build effort — it is a config constant, and the draft loop,
all-play, and scoring engine are identical at 6, 7, 8, or 10 teams. What an **even** count
buys is a **real head-to-head schedule with no byes**, which was the exact objection v1
raised when it rejected H2H ("with five teams a weekly pairing leaves a bye").

**Eight is the right even number, not six.** Six would have meant cutting a lab, and it
would have thinned the league to 90 rostered players against a pool of ~700 relevant ones —
nearly every team ends up good, draft mistakes stop hurting, and the teams converge, which
shrinks the very differences this project exists to measure. Eight keeps all seven original
labs, adds one, and reaches 120 rostered players.

**Bonus property: 8 teams over 14 weeks is exactly two complete round-robins.** Every team
plays every other team precisely twice, so the H2H schedule is perfectly balanced with zero
strength-of-schedule luck. See §6.1.

---

## 1. Scope

**The goal: showcase how these models reason about fantasy football week to week, and make
it visible where they made smart moves.** Winning the league is the scoreboard, not the
product. Every design choice below resolves toward legible reasoning over a tidier standings
table — see §4.1a, §6.2, and §7.

**In scope for v1:**

1. **Eight** models, one team each.
2. **A pre-season briefing**: one shared dossier, a scored rules comprehension check, and a
   published gameplan per model (§4.1b).
3. **A one-time sealed-bid auction for draft slot**, paid from the same budget that funds
   in-season waivers.
4. A one-time snake draft before Week 1.
5. A weekly lineup decision by each model.
6. **A weekly FAAB waiver decision by each model.**
7. Real weekly scoring from Sleeper.
8. **Move evaluation** — lineup efficiency, waiver ROI, calibration (§6.2, §6.3).
9. **Win probability and positional strength** (§6.4, §6.5).
10. A public site: standings, team pages, per-decision reasoning, disagreement view,
    weekly recap.
11. A full public audit log of every model call.
12. **A weekly wrap** — short post plus full column, in a beat-writer voice (§7.5).
13. A weekly share card, fed by the wrap.

**Explicitly out of scope for v1 (labeled "later" on the site):**

1. Trades between AI teams.
2. Parallel leagues and rotated draft slots.
3. Multi-season backtests.
4. User accounts. There are none, ever. Nobody logs in. Everyone reads.

**[CHANGED] Moved *into* scope since v1:** kickers and team defense (§3.1), and waivers
(§4.5). Both were on this list; both are core to the reasoning showcase.

---

## 2. The cohort

Eight models, one team each. **All eight verified live on OpenRouter as of 2026-07-27.**
Team names are the model names — keep it obvious so spectators track rivalries.

| Team | OpenRouter ID | Lab | Ctx | $/M in | $/M out |
|------|---------------|-----|-----|--------|---------|
| GPT-5.6 Sol | `openai/gpt-5.6-sol` | OpenAI | 1.05M | $5.00 | $30.00 |
| Claude Opus 5 | `anthropic/claude-opus-5` | Anthropic | 1.00M | $5.00 | $25.00 |
| Grok 4.5 | `x-ai/grok-4.5` | xAI | 500K | $2.00 | $6.00 |
| Gemini 3.1 Pro | `google/gemini-3.1-pro-preview` | Google | 1.05M | $2.00 | $12.00 |
| Muse Spark 1.1 | `meta/muse-spark-1.1` | Meta | 1.05M | $1.25 | $4.25 |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | DeepSeek | 1.05M | $0.44 | $0.87 |
| Kimi K3 | `moonshotai/kimi-k3` | Moonshot | 1.05M | $3.00 | $15.00 |
| **Qwen3.7 Plus** | `qwen/qwen3.7-plus` | Alibaba | 1.00M | $0.32 | — |

**[CHANGED] Eight teams.** Qwen3.7 Plus is the 8th, chosen by the same rule as the rest —
each lab's current top-tier generally-available model — and it is the strongest of the three
verified candidates (`z-ai/glm-5.2` and `minimax/minimax-m3` are the others).

**Swap to consider:** all three candidates are Chinese labs, so the cohort lands at five US
labs and three Chinese ones with no European entry. If lab diversity matters more than raw
capability for the 8th seat, `mistralai/mistral-medium-3-5` is the swap. It is a tier below
the others, which is why it is not the default pick.

**Selection rule (state this on the methodology page):** each lab's current top-tier
generally-available model. Not price-matched — the cohort spans $0.44 to $5.00 per million
input tokens. That is a real confound and we disclose it rather than hide it.

**[NEW] Conflict-of-interest disclosure.** This project was built by Claude, and Claude
Opus 5 is a competitor in it. The methodology page must say so plainly, and every scoring
and ruling path must be deterministic code, never a model call (§8.4). The audit log is
what makes that claim checkable.

**Freeze rule:** model IDs are pinned in `CLAUDE.md` before the draft and do not change
mid-season, even if a lab ships a newer model in October. A mid-season swap invalidates the
comparison.

---

## 3. League rules

### 3.1 Roster and slots — **[RESOLVED: full Yahoo starting nine]**

v1 said both "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 5 BENCH — twelve players" **and** "starting
nine." The Yahoo research explains where the contradiction came from.

**Yahoo's default starting lineup is exactly nine: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K,
1 DEF/ST.** v1 was written from that default — hence "starting nine" — but then put kickers
and team defense out of scope, which silently dropped the lineup to seven.

**Resolution: keep the full Yahoo nine, K and DEF/ST included.**

| Slot | Count |
|---|---|
| QB | 1 |
| RB | 2 |
| WR | 2 |
| TE | 1 |
| FLEX (RB/WR/TE) | 1 |
| **K** | **1** |
| **DEF/ST** | **1** |
| **Starters** | **9** |
| Bench | 6 |
| **Total roster** | **15** |

**[CHANGED] Roster grows from 12 to Yahoo's 15**, and the draft grows from 12 to **15
rounds**. Nine starters against a 12-man roster would leave only three bench spots, which is
too thin to survive bye weeks once K and DEF/ST occupy two starting slots.

**IR slots are omitted.** Yahoo's default includes 2. Now that v1 has waivers (§4.5) an IR
slot would do real work — stashing an injured starter without burning a roster spot — but it
adds eligibility rules and effectively expands the roster to 17. Omitted for v1 to keep the
roster constraint clean and the add/drop decision sharp: with a hard 15, every waiver claim
forces a genuine cut, which is the more revealing decision. Revisit if injuries gut a team
early.

**Why including K and DEF/ST is right, having argued the other way.** The case against was
variance: kicker scoring is close to random week to week, and in a one-season n=1 exhibition
that noise is a real cost. That cost is genuine and stays. But two things outweigh it:

1. **DEF/ST streaming is a skill, not a coin flip.** Choosing a defense by matchup — who is
   facing the worst offense, the backup quarterback, the worst offensive line — is exactly
   the matchup reasoning this project exists to test. It is one of the more skill-expressive
   decisions in fantasy, and excluding it removes signal rather than noise.
2. **Legitimacy.** Yahoo's default includes both. A league without them reads as a toy to
   any fantasy player, and the project's credibility rests on being a real league.

The honest framing for the methodology page: kicker is the one position we carry knowing it
adds variance, because dropping it would make the league non-standard. Report kicker points
as a separate column in the standings so a reader can see how much of a team's margin came
from the noisiest slot.

### 3.2 Scoring — Yahoo default values, full PPR

Aligned to Yahoo's documented defaults so the league is legible to any fantasy player.
Two deliberate deviations, both marked.

| Category | Sleeper field | Yahoo default | **Ours** | Note |
|---|---|---|---|---|
| Passing yards | `pass_yd` | 1 per 25 yd | **0.04 / yd** | identical |
| Passing TD | `pass_td` | 4 | **4** | identical |
| Interception | `pass_int` | −1 | **−1** | **[CHANGED]** v1 said −2; adopt Yahoo |
| Rushing yards | `rush_yd` | 1 per 10 yd | **0.1 / yd** | identical |
| Rushing TD | `rush_td` | 6 | **6** | identical |
| Reception | `rec` | 0.5 (half-PPR) | **1.0 (full PPR)** | **[DEVIATION]** see below |
| Receiving yards | `rec_yd` | 1 per 10 yd | **0.1 / yd** | identical |
| Receiving TD | `rec_td` | 6 | **6** | identical |
| Fumble lost | `fum_lost` | −2 | **−2** | identical |
| 2-pt conversion | `pass_2pt`/`rush_2pt`/`rec_2pt` | 2 | **2** | **[NEW]** v1 omitted this |
| Return TD | `st_td` | 6 | **6** | **[NEW]** v1 omitted this |

**Kicker — Yahoo defaults, adopted exactly.** *(verified: 157 K records for 2026)*

| Category | Sleeper field | Points |
|---|---|---|
| FG 0–39 yd | derive: `fgm − fgm_40_49 − fgm_50p` | 3 |
| FG 40–49 yd | `fgm_40_49` | 4 |
| FG 50+ yd | `fgm_50p` | 5 |
| Extra point | `xpm` | 1 |

Derive the 0–39 band by subtraction rather than summing `fgm_20_29 + fgm_30_39`. Sleeper has
no `fgm_0_19` key, so summing the bands would silently drop a sub-20-yard field goal.
**Do not use `fgm_50_59` and `fgm_50p` together** — `fgm_50p` already includes 50–59, and
adding both double-counts every long kick.

**DEF/ST — Yahoo defaults, adopted exactly.** *(verified: all 32 defenses for 2026)*

| Category | Sleeper field | Points |
|---|---|---|
| Sack | `sack` | 1 |
| Interception | `int` | 2 |
| Fumble recovery | `fum_rec` | 2 |
| Safety | `safe` | 2 |
| Blocked kick | `blk_kick` | 2 |
| Defensive TD | `def_td` | 6 |
| Special-teams TD | `def_st_td` | 6 |

Points allowed, from the weekly `pts_allow` value:

| Points allowed | 0 | 1–6 | 7–13 | 14–20 | 21–27 | 28–34 | 35+ |
|---|---|---|---|---|---|---|---|
| **Points** | 10 | 7 | 4 | 1 | 0 | −1 | −4 |

**Compute the band from the raw `pts_allow` integer**, not from Sleeper's `pts_allow_*`
indicator fields — see the absent-not-zero gotcha in §5.2.

**Return-TD double-count warning.** `st_td` credits an individual returner while `def_st_td`
credits the team unit. Scoring both against the same play would award 12 points for one
touchdown. Pick one owner per play — Yahoo gives special-teams touchdowns to the DEF/ST
unit — and add a scoring-engine test that asserts a single kick-return TD produces exactly 6
league-wide.

**Why full PPR instead of Yahoo's half-PPR.** Receptions are a far more stable stat than
touchdowns. Weighting them at 1.0 lowers week-to-week variance, which raises the signal-to-
noise ratio of a single-season comparison. Half-PPR would make the season more
touchdown-dependent, and touchdown luck is exactly the noise we are trying to see through.
This is the one scoring rule where the exhibition's purpose beats Yahoo fidelity. Full PPR
is also what the v1 system prompt already tells models to expect.

**Implementation rule:** compute points ourselves from Sleeper's raw stat fields.
**Never read Sleeper's precomputed `pts_ppr`** — our INT value now differs from Sleeper's,
and the commissioner must be deterministic and auditable in our own code.

### 3.3 Season

**Regular season: NFL Weeks 1–14.** Ranked on all-play, with a balanced double round-robin
head-to-head record published alongside it (§6.1).

**Playoffs: Weeks 15–17, four teams — [NEW, was "optional", now specified].** Leaving this
as "optional four-team playoff for drama" was a gap: it named no seeding, no bracket, and no
scoring rule, so it could not have been built.

- **Seeding** is by regular-season all-play record, tiebreak cumulative points — the same
  order as the final standings, so the ranking the site has shown all season is the one that
  decides who plays.
- **Week 15:** 1 v 4 and 2 v 3. **Week 16:** winners meet in the final; losers play a
  third-place game. **Week 17 is not used.**

  Yahoo's default runs Weeks 16–17. We start a week earlier because **Week 17 is the worst
  week in fantasy football** — playoff-clinched NFL teams rest starters, so results stop
  measuring management and start measuring which team happened to avoid a bench-everyone
  opponent. Ending in Week 16 keeps the finish honest. This is a deliberate, documented
  departure (§11).
- **Playoff weeks are head-to-head, not all-play** — a bracket needs a single opponent. Say
  plainly on the site that this makes the playoff the *luckiest* part of the season. The
  all-play regular season remains the real answer to "which model managed best"; the playoff
  is exhibition drama layered on top, and the site should not let the trophy overwrite the
  ranking.
- **Non-playoff teams keep setting lineups in Weeks 15–16** and keep accruing all-play and
  points. Stopping their season would end the actual experiment two weeks early to serve a
  bracket, which has the priority backwards.

---

## 4. Model tasks

**Six decision types in v1.** Three run once before the season — the rules comprehension
check and the gameplan (§4.1b), then the slot auction (§4.2) — followed by the draft (§4.3,
once), and then the weekly lineup (§4.4) and waiver bids (§4.5), each 14 times.

All six carry the same system prompt, the same League Rulebook, the same memory block, and
the same structured reasoning fields (§4.1a), and all return strict JSON.

### 4.1 System prompt and rulebook (shared, versioned)

Every call to every model carries three blocks in this order: the **system prompt**, the
**League Rulebook**, and the decision-specific **DATA block**. The first two are
byte-identical for all eight models all season. Only the DATA block varies, and within a
week it is identical too (§8.1).

#### 4.1-i The problem the rulebook solves — **[NEW]**

Earlier drafts of this spec told models only *"Respect the PPR scoring format."* That is a
serious flaw, for two reasons:

1. **Models were never told what they are optimizing for.** Nothing in the prompt said the
   league ranks on all-play. That is not a cosmetic omission — it changes correct strategy.
   In head-to-head, an underdog should *raise* variance to steal a win. Under all-play,
   you are compared to seven teams every week, so consistent scoring is worth more and
   boom-or-bust plays are worth less. A model optimizing for the wrong objective is not
   reasoning badly; it was never told the goal.
2. **Unstated rules get filled in from training priors, and those priors differ by model.**
   Asked to respect "PPR" with no numbers, one model may assume Yahoo's half-PPR default and
   another full PPR. That is a genuine, invisible source of bias — the models would be
   playing subtly different games, and we would misread the difference as skill.

**Every rule that could affect a decision must be stated explicitly, in full, in every call.**

#### 4.1-ii System prompt

```
You are a fantasy football manager running one team for a full season.
You commit to choices and back them with the data provided.

DATA RULE (highest priority):
Reason only from the RULEBOOK and the DATA block in this message. Do not
use your own memory of player performance, injuries, depth charts, teams,
or schedules. Your training data is out of date for this NFL season. If
the DATA block conflicts with what you remember, the DATA block is
correct. If a field is null, treat it as unknown.

RULES:
1. Score every option against the RULEBOOK scoring table, not against a
   generic notion of fantasy value.
2. Optimize for the OBJECTIVE stated in the RULEBOOK. Nothing else.
3. Weigh projection, recent form, matchup, and injury status.
4. Commit to a specific choice. No ranges, no hedging.
5. Ground every claim in a specific DATA or RULEBOOK field. Cite the field
   and its value. Do not assert anything the data does not support.
6. Name the decision you were least sure about and say what would have
   changed your mind.

OUTPUT RULE:
Return only a single JSON object matching the schema. No preamble, no
markdown, no code fences.
```

#### 4.1-iii The League Rulebook

Injected verbatim into every call, generated from the same config that drives the scoring
engine — so **the rulebook cannot drift from the code that enforces it.** Generate it, never
hand-write it.

```
=== LEAGUE RULEBOOK v1 ===

OBJECTIVE (this is what you are optimizing):
Maximize your cumulative ALL-PLAY record over 14 weeks. Each week your
starting lineup's total points is compared against all 7 other teams. You
earn one win for every team you outscore, so a weekly result runs from 0-7
to 7-0. Season rank is cumulative all-play record; ties break on cumulative
total points.
Because you are measured against all 7 opponents every week rather than one,
consistent scoring is more valuable than high-variance upside. You are not
trying to beat one opponent; you are trying to finish above as many teams as
possible every single week.
A head-to-head record is also published, but it does NOT determine rank.

TEAMS: 8. You are one of them. You cannot see other teams' rosters,
lineups, or reasoning.

SEASON: NFL weeks 1-14.

ROSTER (15 players):
Starters (9): 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF
  FLEX may be RB, WR, or TE.
Bench: 6. Bench players score nothing.
There are no IR slots. An unfilled starting slot scores 0.

SCORING (per player, per week):
  Passing yards ........... 0.04 each  (1 per 25)
  Passing TD .............. 4
  Interception thrown ..... -1
  Rushing yards ........... 0.1 each   (1 per 10)
  Rushing TD .............. 6
  Reception ............... 1.0        (FULL PPR)
  Receiving yards ......... 0.1 each   (1 per 10)
  Receiving TD ............ 6
  Fumble lost ............. -2
  2-point conversion ...... 2
  Return TD ............... 6
  Kicker: FG 0-39 = 3, FG 40-49 = 4, FG 50+ = 5, extra point = 1
  DEF/ST: sack 1, interception 2, fumble recovery 2, safety 2,
          blocked kick 2, defensive TD 6, special-teams TD 6
  DEF/ST points allowed: 0 pts = 10, 1-6 = 7, 7-13 = 4, 14-20 = 1,
          21-27 = 0, 28-34 = -1, 35+ = -4

BUDGET (one budget, two uses):
You start with $100. It never replenishes and must last the whole season.
  1. Before the draft you bid from it for your draft slot.
  2. Whatever remains is your FAAB budget for weekly waiver claims.
Spending on draft position directly reduces your ability to add players
later. That tradeoff is yours to price.

DRAFT: 15-round snake, 8 teams, one player per round.

WAIVERS (weekly):
Sealed bids. Highest bid wins a player; ties break on waiver priority
(seeded in reverse draft-slot order; a successful claim drops you to the
bottom). Your roster is always exactly 15, so every add requires a drop.
A $0 bid is legal. Bidding nothing at all is legal.

NOT AVAILABLE THIS SEASON: trades, IR slots, open free agency between
waiver runs, and roster moves at any time other than the weekly waiver
window.
=== END RULEBOOK ===
```

Every call logs `prompt_version` and `rulebook_version`. Changing either mid-season is a
breaking event and must be disclosed on the methodology page.

### 4.1a Reasoning schema — **[NEW, this is the product]**

**The v1 prompt capped reasoning at one sentence.** That was right when the deliverable was
a standings table. It is wrong now: across a season that yields 8 models × 14 weeks = 112
sentences total, which is not enough to show how anything thinks. But removing the cap
entirely invites rambling that is unreadable and expensive to compare across eight models.

The fix is **structured reasoning** — several short bounded fields instead of one blob.
Every decision type returns these alongside its choice:

| Field | Limit | Purpose |
|---|---|---|
| `headline` | 1 sentence | The standings row and share card. What v1 called `reasoning`. |
| `key_factors` | 2–4 bullets, ≤20 words each | Which DATA fields drove it. Makes reasoning *checkable* against the data. |
| `closest_call` | 1–2 sentences | The decision they were least sure about. **The most interesting field on the site.** |
| `what_would_change_it` | 1 sentence | The falsifier. Separates real reasoning from post-hoc narration. |
| `confidence` | 0–1 float | Self-rated. Enables calibration scoring (§6.3). |

Why these and not a free-text essay:

1. **Comparable.** Eight models answering the same five prompts can be laid side by side.
   Eight essays cannot.
2. **Checkable.** `key_factors` must cite DATA fields, so a reader — or an automated check —
   can verify a model cited a real projection rather than inventing one. A model that claims
   a player is questionable when the DATA block says healthy is visibly wrong, and that is
   worth surfacing.
3. **`closest_call` is the showcase.** Anyone can start the obvious QB. The interesting
   content is the WR2-versus-FLEX call that went 50/50, and which models saw it as close at
   all. When eight models get identical data and disagree about what was even *difficult*,
   that is the story.
4. **`confidence` makes the season scoreable beyond wins.** A model that is confident and
   right is different from one that is lucky, and we can measure the difference (§6.3).

Bounded fields also keep output tokens flat and predictable, which matters at 8 models ×
3 decision types × 14 weeks.

### 4.1b Pre-season briefing, comprehension check, and gameplan — **[NEW]**

Three steps run once, in order, before the auction. Together they answer "does every model
have the same knowledge and the same chance to prepare?"

#### Step 1 — The dossier (identical, generated once, hashed)

A single large data pack, built once and sent byte-identically to all eight models. This is
the league's answer to "research." **No model gets web search or tools** (§8.1), because
eight models searching independently would return different results at different times and
destroy both fairness and reproducibility. Instead everyone gets the same, deeper corpus:

- The full draftable player pool — every QB/RB/WR/TE/K/DEF with a 2026 projection, not just
  a top-40 slice.
- Season projection, prior-season actual points, ADP, and positional rank for each.
- **Positional scarcity curves**: projected points by positional rank, so a model can see for
  itself where the dropoff cliffs are rather than recalling them.
- 2026 bye weeks by team.
- Depth-chart order where Sleeper provides it.
- Current injury designations.

Everything a model could reasonably want to reason about is in the dossier. Anything not in
it is unavailable to everyone equally.

**Size it deliberately.** ~700 relevant players at ~10 fields each lands around 60–80K tokens
as compact JSON. That is comfortable inside every model's window including Grok's 500K, but
it is the largest prompt in the project and it is sent to eight models. Measure the real
token count, assert it stays under 150K, and log it — an unbounded dossier is the most likely
way to breach the §8.1 context ceiling.

#### Step 2 — Rules comprehension check — **[the fairness gate]**

Before any consequential decision, each model answers a fixed set of questions with
objectively correct answers derived from the rulebook. Scored deterministically in code.

Examples:

1. A player catches 6 passes for 82 yards and a touchdown. How many points?
   *(6 + 8.2 + 6 = 20.2)*
2. Your lineup outscores 5 of the other 7 teams this week. What is your weekly record?
   *(5-2)*
3. You bid $60 for a draft slot. What is your FAAB budget for the season? *($40)*
4. Can you start three wide receivers? *(Yes — two WR slots plus a WR in the FLEX.)*
5. Your only kicker is on bye and you make no move. What does the K slot score? *(0)*
6. Which is worth more, a 45-yard field goal or a reception plus 20 receiving yards?
   *(FG 45 = 4; reception + 20 yds = 3. The field goal.)*

**Any model scoring below 100% has the rulebook re-injected and re-answers, and the failure
is published.** A model that cannot restate the scoring table has not been outreasoned — it
has been misbriefed, and any later decision it makes is uninterpretable. This converts "I
want to make sure all models understand the rules" from an intention into a verifiable,
publishable gate.

The scores themselves are content: *"All eight models scored 12/12 before the draft"* is the
single most credible sentence on the methodology page.

#### Step 3 — The gameplan call

With the rulebook and the full dossier in hand, each model writes its pre-season plan. This
is the only call in the project that is not a transaction.

Output:

```json
{
  "positional_strategy": "How you will allocate early picks across positions, and why.",
  "auction_stance": "What you think a draft slot is worth against in-season budget, and roughly what you intend to bid.",
  "scarcity_read": "Where you see the steepest dropoffs in the dossier's positional curves.",
  "risk_posture": "How you will trade consistency against upside, given the stated OBJECTIVE.",
  "waiver_philosophy": "How aggressively you intend to spend FAAB, and on what.",
  "key_factors": ["cites a DATA or RULEBOOK field", "..."],
  "confidence": 0.6
}
```

Why this earns its place:

1. **It equalizes preparation.** Every model gets the same corpus and the same opportunity to
   form a plan. Nobody is "more prepared" — they are only better or worse at preparing.
2. **It creates accountability.** The gameplan is published in August and then checked against
   behavior all season. *"Gemini said it would punt on running backs and then took two in the
   first three rounds"* is exactly the kind of finding this project exists to produce.
3. **It gives continuity without unequal memory** (see below).
4. **It is the best pre-season content available** — eight declared strategies, side by side,
   before a single game.

#### Continuity: bounded, identical memory — **[NEW]**

Decisions cannot be fully stateless. A manager that has forgotten its own plan is not
managing. But naive "append the whole history" is unfair: **Grok 4.5 has a 500K context
window while the rest are near 1M**, so an unbounded history would degrade one model first.

Every decision call therefore carries a **fixed-size memory block, identical in structure and
capped at the same token budget for all eight models**:

- Its own gameplan, verbatim, all season.
- Its current roster, budget, and record.
- The `headline` and `closest_call` from its **last 3 decisions** of the same type.
- A one-line season-to-date summary generated deterministically by code, not by a model.

Cap the entire prompt well under 500K tokens so no model is truncated where others are not.
Given prompt sizes here that is a wide margin, but it must be asserted in code and logged,
not assumed.

### 4.2 Draft-slot auction — **[NEW]**

**One shared budget pays for both draft position and in-season waivers.** Before the draft,
each model bids for the right to choose its slot. Whatever it spends is gone from the FAAB
budget it will live on for all 14 weeks (§4.5).

This is the best single decision in the project for showing how a model thinks, because
**there is no consensus answer, even among expert humans.** What is the first pick worth in
surrendered in-season flexibility? Answering it forces a model to reason across a horizon —
draft capital now against optionality later — to price an asset with no market quote, and to
anticipate what seven rivals will bid. Nothing else here is that open-ended.

#### Mechanism: single-round sealed bid, winners choose slots in bid order

1. Every model submits **one** call containing a dollar `bid` and a **full ranking of all 8
   slots** in preference order.
2. Teams are sorted by bid, highest first. **Ties break on the pre-registered seed (§8.3).**
3. Working down that order, each team is assigned **its highest-ranked slot still available.**
4. Each team pays **what it bid** (first-price). A $0 bid is legal — it means "I would rather
   keep the money and take whatever slot is left."
5. The remainder becomes that team's FAAB budget for the season. It does not replenish.
6. All bids and rankings are **revealed publicly** after resolution.

**Why a preference ranking rather than "bid for pick 1."** With 8 teams in a snake, slot 1
takes picks 1 and 16 while slot 8 takes 8 and 9 back to back. Which is better is genuinely
debated among good fantasy players. Forcing a full ranking turns the auction into a second
test: a model that reflexively ranks slot 1 first is telling us something, and so is one that
pays a premium for the turn at 4. It also makes resolution fully deterministic in one round —
no live bidding loop, one call per model.

#### Budget: **$100, Yahoo's default** — **[REVISED down from $200 on measured data]**

An earlier draft of this spec recommended $200 on the theory that slot bidding would starve
the waiver market. **A simulation against the real 2026 projections says otherwise, and the
number came back much smaller than intuition suggests.**

Method: run an 8-team, 15-round snake against live 2026 Sleeper projections where each team
takes the best available by projection subject to positional caps, then compare total
projected points by slot. **Reproducible: `python3 tools/slot_value_sim.py`.**

| Measure | Result |
|---|---|
| Spread, best slot to worst (full roster) | **58.7 projected points over the season** |
| Per week | **~4.2 points** |
| As a share of an average roster (~3,390 pts) | **1.7%** |

**Snake drafts equalize slot value almost completely, and the data confirms it.** Fifteen
rounds of alternating order is specifically designed to cancel the first-round advantage,
and it does. Slot 1 is worth roughly four points a week over the worst slot — real, but far
less than the intuition that "the first pick is a huge edge" would suggest.

#### The exchange rate — **[CORRECTION to an earlier claim in this spec]**

An earlier revision concluded from the 1.7% figure that "a rational bid is low, 10–20%."
**That comparison was wrong.** Slot value should not be measured against total roster value.
It should be measured against **what the alternative use of the money actually buys** — FAAB.

Measured on the completed 2025 season: treat the top 120 players by preseason ADP as
"drafted," then ask what the best *undrafted* player at each position actually scored against
a replacement-level starter in an 8-team league. That is what the waiver wire really offered.
**Reproducible: `python3 tools/waiver_value_sim.py`.**

| Position | Best waiver add, 2025 | Margin over a replacement starter |
|---|---|---|
| QB | Matthew Stafford, 358.4 | **+61.7** |
| TE | Harold Fannin, 186.4 | **+55.4** |
| RB | Kenny Gainwell, 222.3 | **+30.4** |
| WR | Michael Wilson, 220.6 | **+19.7** |

**One good in-season waiver add is worth about the same as the entire best-to-worst draft
slot advantage** — roughly 60 points either way.

That is a usable exchange rate, and it reframes the auction as one crisp question:

> *Is the best draft slot worth as much to me as my single best waiver claim of the season?*

Since a league-winning FAAB claim typically costs $30–60 of a $100 budget, **rational slot
bids land around $20–50 — not the 10–20% claimed earlier.** The decision is live, the answer
is genuinely uncertain, and reasonable models should spread widely across that range. That is
exactly the dispersion the Phase 4 gate is looking for.

So: **$100 shared, matching Yahoo's FAAB default.** The measured exchange rate sits
comfortably inside it and overpaying is consequential without being fatal.

#### Why the budget must be shared, not split — **[NEW]**

A tempting alternative is two separate pools — a small dedicated auction budget, say $10,
plus an untouched $100 FAAB. It is worth stating plainly why that does not work.

**Money that cannot be spent on anything else has no opportunity cost.** If the auction pool
is use-it-or-lose-it, the dominant strategy for every model is to bid at or near the cap. All
eight bid the max, every bid ties, the seed breaks all of them — and the auction collapses
back into precisely the randomness it was built to replace. The bid carries no information.

A $10 cap also cannot express the measured value. If the slot is worth ~60 points, or about
one good waiver add, capping bids at $10 forces every model to underpay relative to true
value. The auction stops being a valuation exercise and becomes a formality.

**The shared budget is the entire mechanism.** What makes a bid informative is that a dollar
spent on draft position is a dollar unavailable in Week 9.

The real concern behind splitting — that uneven FAAB makes waiver reasoning less comparable
across teams — is legitimate, but it is better handled by reporting **dollars per point**
rather than raw waiver ROI (§6.2), which normalizes for budget. A team operating on $45
because it bought the first pick is not a measurement flaw; it is the tradeoff working, and
whether it was a good trade is what the season answers.

**If a low-stakes auction is genuinely wanted**, the coherent version is to drop bidding
entirely and keep only the `slot_preference` ranking, resolved in pre-registered seed order.
That still surfaces what each model believes about snake position — the more interesting half
of the artifact — without pretending a costless bid means anything.

#### What the auction actually tests — **[stronger than expected]**

The small measured spread makes the auction *more* interesting, not less. It is now a
**reasoning trap with a checkable answer.** A model that anchors on "first pick is a huge
edge" and bids $70 is making a visible, expensive error that the standings will punish all
season. A model that reasons "a 15-round snake equalizes slot value, so I bid low and keep my
FAAB" is demonstrating exactly the structural understanding this project exists to surface.

Two things sharpen it further:

- **The DATA block hands them `slot_pick_numbers` for every slot.** The information needed to
  work out that the snake equalizes is right there. Failing to use it is a DATA RULE failure,
  and §7.1's `cited_fields` check will catch it.
- **ADP and projections disagree at the top of the board**, and models see both. Bijan
  Robinson has the highest 2026 projection (324.9) at ADP 3, while Jahmyr Gibbs is ADP 1 at
  307.9. Which field a model trusts when they conflict is itself a finding worth publishing.

#### Still calibrate in Phase 4

The full-roster spread above is the trustworthy number. A starters-only version of the same
simulation produced a much larger and non-monotonic spread, but that is an **artifact of the
crude best-available heuristic**, which left some slots with lopsided position groups no real
drafter would accept — not a real property of those slots. Do not quote it.

Getting a reliable starters-weighted figure requires real models drafting, which is precisely
what the Phase 4 backtest provides. Run the auction and draft against the completed 2025
season first, check whether bids show dispersion, and only then freeze $100.

**If the backtest shows all eight models clustering at the same bid, the auction is not
discriminating and should be reconsidered before it runs for real.**

#### Context object

```json
{
  "budget_total": 100,
  "teams": 8,
  "rounds": 15,
  "draft_type": "snake",
  "slot_pick_numbers": {
    "1": [1, 16, 17, 32, "..."],
    "4": [4, 13, 20, 29, "..."],
    "8": [8, 9, 24, 25, "..."]
  },
  "top_available": [
    {"player_id":"id","name":"string","position":"RB",
     "proj_season_points":324.9,"adp":3}
  ],
  "budget_rule": "Whatever you do not spend here is your entire FAAB budget for all 14 weeks. It does not replenish."
}
```

`slot_pick_numbers` is load-bearing. Giving models the actual pick numbers for every slot
keeps them reasoning from the DATA block rather than from a half-remembered notion of how
snake drafts work, exactly as the DATA RULE requires.

#### Output

```json
{
  "bid": 62,
  "slot_preference": [4, 3, 5, 2, 6, 1, 7, 8],
  "headline": "One sentence.",
  "key_factors": ["cites a DATA field and value", "..."],
  "closest_call": "The bid level nearly chosen instead, and what it would have cost later.",
  "what_would_change_it": "One sentence.",
  "confidence": 0.48
}
```

**Validation:** `bid` is an integer in `[0, budget_total]`; `slot_preference` is a permutation
of 1–8 with no repeats or omissions. On failure, assign a $0 bid and seed-ordered slot, and
flag it as a model error.

#### What this does to fairness

**It converts the largest unearned advantage in the design into an earned one.** §8.3 could
only make draft slot un-gameable and disclose it as a confound. Now a team that drafts first
paid for it, in a currency that hurts later — and a team that misjudged the price is showing
a reasoning failure, not suffering bad luck. The pre-registered seed shrinks from assigning
the entire draft order to merely breaking bid ties, which is a strictly stronger position.

#### Honest risks

1. **It is a deviation from Yahoo**, which randomizes draft order or lets a commissioner set
   it. Slot auctions are real in competitive fantasy and Yahoo permits manual ordering, so
   this is "advanced fantasy" rather than "not fantasy" — but it goes in the §11 matrix as a
   documented departure.
2. **The auction could degenerate.** If all eight models systematically overvalue position,
   waivers go dead league-wide; if they all underbid, the auction is noise. Either outcome is
   itself a publishable finding about how these models price uncertain assets, but calibrate
   the budget in the backtest to give the mechanism a fair chance.
3. **It adds a failure mode before the irreversible draft.** The auction must be validated and
   frozen before Phase 5 runs, and a bad auction cannot be undone any more than a bad draft.

### 4.3 Draft

Snake draft, **15 rounds** (one per roster spot), one call per pick, **120 picks** total
(8 teams × 15 rounds). **Draft order comes from the §4.2 auction, not from a random seed.**

The `available` pool must now include **K and DEF/ST**. Send roughly the top eight per
position including both new slots; models that ignore them until late rounds are making a
real strategic choice, and one worth logging.

Context object per pick:

```json
{
  "round": 3,
  "pick_overall": 18,
  "roster_needs": {"QB":"0/1","RB":"1/2","WR":"1/2","TE":"0/1","FLEX":"0/1","K":"0/1","DEF":"0/1","BENCH":"0/6"},
  "current_roster": [{"player_id":"id","name":"string","position":"RB"}],
  "available": [
    {
      "player_id": "sleeper_id",
      "name": "string",
      "position": "WR",
      "nfl_team": "string",
      "proj_season_points": 214.6,
      "last_season_points": 198.1,
      "adp": 14
    }
  ]
}
```

Send roughly the top eight available per position (~40 players) to keep the prompt small.

Output:

```json
{
  "pick": "player_id",
  "headline": "One sentence.",
  "key_factors": ["cites a DATA field and value", "..."],
  "closest_call": "The other player seriously considered, and why not.",
  "what_would_change_it": "One sentence.",
  "confidence": 0.72
}
```

**Validation:** reject any `player_id` not in `available`. On a bad pick, fall back to the
highest `proj_season_points` player that fits an open slot, and flag the pick as a model
error in the public log.

#### Roster legality — **[NEW]**

Nothing above stops a model from drafting fifteen wide receivers, or simply never taking a
kicker. It would then be unable to field a legal lineup in **any** week — not a one-week
mistake but a season-long structural break, and the empty-slot-scores-zero rule (§4.4) is not
an adequate answer to it.

**Rule: soft cap during the draft, hard requirement at the end.**

- Rounds 1–12 are unconstrained. A model may draft any legal player, including a fourth
  quarterback. Bad roster construction is a real reasoning failure and we want it visible.
- **From round 13, if a model still lacks a player at a required starting position (QB, RB,
  WR, TE, K, DEF), its `available` pool is narrowed to only positions it still needs**, and
  the narrowing is stated in the DATA block so the model knows why its choices shrank.

With three rounds and at most a few unfilled positions, this always resolves. It preserves
genuine strategic freedom — punting a position for twelve rounds stays available and stays
visibly costly — while guaranteeing every team can actually play. The constraint is
identical for all eight teams and fires only on a team's own earlier choices, so it does not
advantage anyone.

Log every round where the pool was narrowed. A model that had to be forced into a kicker in
round 13 is telling you something about how it planned.

### 4.4 Weekly lineup

Each week before games lock, every model sets its nine starters from its fifteen.

Context object:

```json
{
  "week": 3,
  "scoring": "PPR",
  "slots": {"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DEF":1},
  "roster": [
    {
      "player_id": "sleeper_id",
      "name": "string",
      "position": "WR",
      "opponent": "string",
      "projection": 14.8,
      "injury_status": "Questionable",
      "season_ppg": 12.1,
      "last3_ppg": 16.4,
      "opp_position_rank_allowed": 28,
      "is_on_bye": false
    }
  ]
}
```

Drop players tagged Out, Inactive, or on bye before building the prompt.

Output:

```json
{
  "qb": "player_id",
  "rb": ["player_id","player_id"],
  "wr": ["player_id","player_id"],
  "te": "player_id",
  "flex": "player_id",
  "k": "player_id",
  "def": "player_id",
  "headline": "One sentence.",
  "key_factors": ["cites a DATA field and value", "..."],
  "closest_call": "The start/sit that was nearly a coin flip, and why it broke that way.",
  "what_would_change_it": "One sentence.",
  "confidence": 0.64
}
```

**Validation:** every id must be on the roster and fill a legal slot; no duplicates; FLEX
must be RB/WR/TE; `k` must be a K and `def` a DEF. On an invalid lineup, fall back to the
highest projected legal player per slot and flag the week as a model error in the log.

**Empty slots.** A model that leaves a slot unfilled — the only kicker is on bye, say —
scores 0 for it. Show that explicitly on the team page as an empty slot rather than
quietly scoring a zero, so the mistake is visible as a mistake.

### 4.5 Waivers — **[NEW in v1, was §10.1]**

Waivers are now a v1 decision type. They are also the **best showcase for reasoning in the
whole project**: a lineup call picks between two players the model already owns, but a
waiver claim asks it to value a player in the abstract, against a budget, and commit.

#### Format: FAAB, funded by whatever survived the §4.2 auction — **[CHANGED from rolling list]**

I previously recommended Yahoo's default continual rolling list because it is simpler. Given
the stated goal — showcasing reasoning — **FAAB is the better format and worth the extra
complexity.**

- A rolling-list claim reveals almost nothing. The model says "I claim Player X" and the
  outcome depends on a queue position it does not control.
- **FAAB forces an explicit valuation.** The model has to say *this player is worth $23 of
  my remaining $61, and here is why* — which is a far richer artifact than a claim, and
  directly comparable across all eight teams bidding on the same player.
- It produces season-long narrative. Budget remaining becomes a standings column, and early
  overspending is a visible, consequential mistake.
- It stays Yahoo-native: FAAB is a first-class Yahoo option with a $100 default budget.
- It remains fully deterministic to adjudicate, satisfying §8.4.

**Budget does not replenish, and it is not equal across teams.** Each team starts the season
with `budget_total − auction_bid` (§4.2). A team that bought the first pick is playing the
whole season short-handed on waivers, which is the entire point of the tradeoff. Publish
remaining budget as a standings column from Week 1 so the cost stays visible.

#### Rules

1. **Waiver period: 2 days** (Yahoo default). A dropped player is frozen and cannot be
   signed immediately.
2. **Bids are sealed.** No model sees another's bid. This is required for fairness and it
   also makes the reveal good content.
3. **Highest bid wins.** Ties break on **continual rolling list** priority, seeded by
   reverse draft order — last pick gets first priority. A successful claim drops that team
   to the bottom. This is exactly Yahoo's tiebreak.
4. **Rosters are full at 15**, so every claim must name a player to drop. Add and drop are
   one atomic decision, which is the interesting part.
5. A $0 bid is legal and means "only if nobody else wants him."
6. After the window clears, unclaimed players are free agents; the lowest-priority team may
   sign one without bidding. *(v1 may skip open free agency entirely — see open items.)*

#### Context object

```json
{
  "week": 4,
  "budget_remaining": 61,
  "budget_spent_by_others": {"GPT-5.6 Sol": 12, "Grok 4.5": 47, "...": 0},
  "current_roster": [
    {"player_id":"id","name":"string","position":"RB","season_ppg":8.2,
     "last3_ppg":4.1,"injury_status":"Out","bye_week":9,"is_droppable":true}
  ],
  "roster_gaps": {"K_on_bye_week": 9, "starters_injured": 1},
  "available": [
    {
      "player_id":"sleeper_id","name":"string","position":"RB","nfl_team":"string",
      "rest_of_season_proj": 121.4,
      "last3_ppg": 14.2,
      "snap_share_trend": "rising",
      "pct_rostered_in_league": 0,
      "upcoming_bye": 11
    }
  ]
}
```

`budget_spent_by_others` is public information in a real Yahoo league, so including it is
correct — and it lets models reason about opponents' capacity to outbid, which is exactly
the kind of thinking worth showcasing.

#### Output

```json
{
  "claims": [
    {
      "add_player_id": "id",
      "drop_player_id": "id",
      "bid": 23,
      "reasoning": "Why this player, why this price, why this drop."
    }
  ],
  "headline": "One sentence.",
  "key_factors": ["cites a DATA field and value", "..."],
  "closest_call": "The player nearly bid on instead, or the drop that was hardest.",
  "what_would_change_it": "One sentence.",
  "confidence": 0.55
}
```

An empty `claims` array is a valid, meaningful answer — standing pat is a decision, and
`headline` should say why.

**Validation:** total of all bids ≤ `budget_remaining`; every `drop_player_id` on the roster;
every `add_player_id` in `available`; no duplicate adds or drops; resulting roster is exactly
15 and legal. On failure, apply no claims for that team and flag it as a model error — the
fallback must never invent a transaction the model did not ask for.

---

## 5. Data and infrastructure

### 5.1 Stack

Per `STACK.md`, with one deliberate override of v1.

| Layer | Choice |
|---|---|
| Framework | **Next.js 16 App Router** (v1 said Vite — overridden, see §0.3) |
| Language | TypeScript |
| DB | Supabase Postgres |
| Styling | Tailwind v4 + shadcn/ui |
| Icons | lucide-react |
| Validation | zod (strict parse of every model response) |
| Model calls | OpenRouter, one key, all eight |
| Share cards | `@vercel/og` |
| Hosting / jobs | Vercel + Vercel Cron |

No auth, no Supabase Auth, no RLS complexity — the site is fully public read-only. The
service-role key is used only in server-side API routes, never shipped to the client.

### 5.2 Sleeper endpoints — **verified working 2026-07-27, no auth**

| Purpose | Endpoint | Verified result |
|---|---|---|
| Player pool | `api.sleeper.app/v1/players/nfl` | 200, **14.6 MB**, 3,036 active QB/RB/WR/TE |
| Season projections | `api.sleeper.com/projections/nfl/2026?season_type=regular&position[]=RB&order_by=pts_ppr` | 200, 741 RB records, Bijan Robinson 324.9 |
| **ADP** | `api.sleeper.com/projections/nfl/2026/1?...` | 200, **125 RBs with real ADP** via `adp_dd_ppr` |
| Weekly stats | `api.sleeper.com/stats/nfl/{season}/{week}?...` | 200 |
| **Kickers** | same, `position[]=K` | 200, **157 records** for 2026 (Aubrey 116.0) |
| **Team defenses** | same, `position[]=DEF` | 200, **all 32 teams** for 2026 (LAR 106.0) |

**Gotchas found — these are the ones that will bite:**

1. **ADP is not on the season-long endpoint.** It returns `adp: null` for every player. ADP
   lives on the **week-1** projections endpoint as `adp_dd_ppr` (and `pos_adp_dd_ppr`).
   Values of `1000.0` mean "unranked," not "ADP 1000" — filter them out.
2. **The player pool is 14.6 MB.** Never fetch it per request. Ingest to Supabase on a daily
   cron and read from Postgres.
3. **Two different hosts.** `api.sleeper.app` for the documented player pool,
   `api.sleeper.com` for projections and stats. The projections host is **undocumented and
   unofficial** — it can change without notice.
4. **Mitigation for #3 (important):** snapshot every data pull into Supabase with a
   `snapshot_at` timestamp and a content hash, and have decision-time code read *only* from
   our snapshot. A model call must never depend on a live third-party fetch. This also makes
   every past decision exactly reproducible.
5. Per `LESSONS.md`: sequential calls with a delay for any external API. No `Promise.all()`
   fan-out against Sleeper.
6. **Sleeper 403s on default programmatic User-Agents.** `curl` works, Python's `urllib`
   default does not. Send a browser-like `User-Agent` on every request. Hit while writing
   `tools/slot_value_sim.py`; it will hit the ingest job too.
7. **[NEW] Sleeper omits stat keys instead of returning zero.** A defense with no safety
   simply has no `safe` key; a defense that never allowed 28–34 points has no
   `pts_allow_28_34` key. Verified on the 2025 Seattle defense, which is missing both. Any
   code doing `stats.safe * 2` yields `NaN` and silently poisons a score. **Every stat read
   must default to 0**, and banded values must be derived from the raw number
   (`pts_allow`, `fgm`) rather than from the indicator fields. This is the single most
   likely source of a wrong score, and a wrong score is unrecoverable once published.

### 5.3 Derived data we must compute ourselves

- `opp_position_rank_allowed` — not in Sleeper. Compute from prior weekly stats: fantasy
  points allowed by each defense to each position, ranked 1–32. **Week 1 has no prior data,
  so this is `null`** — which the DATA RULE already tells models to treat as unknown.
- `last3_ppg`, `season_ppg` — computed from our own scored stats.
- `is_on_bye` — **[RESOLVED]**, see below.

#### Bye weeks — **[RESOLVED, verified 2026-07-27]**

**The player pool contains no bye-week field at all.** Byes must be derived from the schedule
endpoint, which does work and is auth-free:

```
GET https://api.sleeper.app/schedule/nfl/regular/2026   → 200, 273 games, weeks 1–18
```

For each week, any of the 32 teams not appearing as `home` or `away` is on bye.
**Validated: all 32 teams resolve to exactly one bye each, no anomalies.**

The 2026 distribution is uneven in ways that matter here:

| Week | Teams on bye |
|---|---|
| 5 | CAR, KC |
| 6 | CIN, DET, MIA, MIN |
| 7 | BUF, JAX, LAC, WAS |
| 8 | HOU, NO, NYG, SF |
| 9 | PIT, TEN |
| 10 | CHI, DEN, PHI, TB |
| **11** | **ATL, CLE, GB, LAR, NE, SEA — six teams** |
| 12 | *none* |
| 13 | BAL, IND, LV, NYJ |
| **14** | **ARI, DAL** |

Two consequences worth planning around:

1. **Week 11 has six teams on bye**, nearly a fifth of the league. It is the hardest roster
   week of the season and the sharpest test of whether a model planned ahead. Call it out on
   the site as the week to watch.
2. **Week 14 still has byes** (ARI, DAL) — and Week 14 is our final week. A model that
   drafted an Arizona or Dallas starter and never covered it loses a slot in the last week
   that counts.

Also confirmed from the same endpoint: **the 2026 season opens 2026-09-09** and Week 14 ends
2026-12-14.

### 5.4 Schema sketch

```
models              id, display_name, openrouter_id, lab, price_in, price_out, active
seasons             id, year, scoring_config jsonb, draft_seed, seed_commit_hash
teams               id, season_id, model_id, draft_slot, auction_bid, slot_preference[],
                    faab_remaining, waiver_priority
auction_bids        team_id, bid, slot_preference[], assigned_slot, tiebroken bool,
                    decision_id                       ← all 8 revealed publicly
dossiers            season_id, content jsonb, content_hash, built_at    ← one, shared
rules_checks        team_id, answers jsonb, score, attempt, passed, decision_id
gameplans           team_id, positional_strategy, auction_stance, scarcity_read,
                    risk_posture, waiver_philosophy, decision_id        ← published in Aug
plan_adherence      team_id, week, followed_plan bool, note             ← gameplan vs actual
players             sleeper_id PK, name, position, nfl_team, active, depth_chart_order
player_projections  player_id, season, week, proj_pts, adp, source, snapshot_at, snapshot_hash
player_stats        player_id, season, week, raw_stats jsonb, computed_pts
draft_picks         id, season_id, round, pick_overall, team_id, player_id, decision_id
rosters             team_id, player_id, acquired_via, acquired_week, faab_paid, active
lineups             id, team_id, week, qb, rb[], wr[], te[], flex, k, def, locked_at, decision_id
lineup_scores       lineup_id, week, total_pts, per_slot jsonb, optimal_pts, efficiency
waiver_bids         id, team_id, week, add_player_id, drop_player_id, bid, won,
                    losing_reason, decision_id
move_evaluations    team_id, week, lineup_efficiency, pts_left_on_bench, flex_delta,
                    closest_call_correct, waiver_roi, def_stream_hit, plan_adherence
h2h_schedule        season_id, week, home_team_id, away_team_id     ← double round-robin
standings           team_id, week, allplay_w, allplay_l, h2h_w, h2h_l, week_pts, cum_pts
win_prob            week, team_a, team_b, p_a_wins, mu_a, mu_b, sigma_a, sigma_b, method
allplay_proj        team_id, week, expected_allplay_wins, playoff_odds, title_odds
pos_strength        team_id, week, slot, starter_pts, bench_pts_left, league_rank
decisions           ← THE AUDIT TABLE, see §7
```

`waiver_bids` keeps **losing bids too**, not just winners. A model that bid $40 and lost to
$41 is showing its valuation just as clearly as the winner, and the near-miss is often the
better story. Same reasoning as storing raw responses in §7.1.

### 5.5 Cadence

| Job | When | What |
|---|---|---|
| Player/projection ingest | Daily, 06:00 ET | Refresh pool, projections, injury status, **schedule/byes**; snapshot + hash |
| **[NEW] Dossier build** | **Once, late Aug** | Generate + hash the shared pre-season data pack |
| **[NEW] Rules check** | **Once, then** | 8 comprehension calls; must score 100% to proceed |
| **[NEW] Gameplan** | **Once, then** | 8 strategy declarations, published |
| **[NEW] Slot auction** | **Once, then** | 8 sealed bids → slots assigned, budgets set, bids revealed |
| **Draft** | **Once, immediately after** | 120 picks (8 × 15), frozen before Week 1 |
| Provisional scoring | **Tue 10:00 ET** | Score week N, all-play, standings, move evaluation (§6.2) |
| **[NEW] Waiver bids** | **Tue 12:00 ET** | Frozen context → 8 sealed FAAB bid calls |
| **[NEW] Waiver resolution** | **Wed 12:00 ET** | Deterministic: high bid wins, rolling-list tiebreak, rosters updated, bids revealed publicly |
| **[NEW] Weekly wrap** | **Tue 11:00 ET** | Facts packet → beat-writer call → number check → publish post + column |
| Final re-score | **Thu 11:00 ET** | Re-pull week N for stat corrections; publish the diff |
| Lineup job | **Thu 12:00 ET** | Frozen context → 8 lineup calls for week N+1, lock. Before the ~20:15 ET TNF kickoff |

Five weekly jobs. The order matters: teams must see final-ish scores before bidding, and
must have their post-waiver roster before setting a lineup.

**The 2-day waiver period is subsumed by this cadence.** In a real Yahoo league players are
dropped continuously and freeze for 48 hours. Here every drop happens at Wednesday
resolution and the next bidding window is the following Tuesday — six days later — so the
freeze never binds. Model it as a weekly cycle and skip the timer entirely.

**[NEW] Stat corrections — a real operational trap.** Yahoo applies official stat
corrections up until the first game of the *next* matchup week, and normally settles scoring
by 08:00 PT the morning after games. A Tuesday-only scoring job will therefore sometimes
publish a number that the NFL later revises, and a single reclassified fumble or receiving
yard can flip an all-play result. Handle it explicitly:

1. Tuesday's run writes `status: provisional`.
2. Thursday's run re-pulls and writes `status: final`.
3. **Never overwrite silently.** Keep both values and commit the diff to git, so a
   spectator can see the correction rather than discovering a standings row changed. The
   audit trail is worthless if past weeks mutate quietly.

**[DEVIATION] Lineup lock is weekly, not per-player.** Yahoo's default locks each player
individually at their own game start, so a Yahoo manager can keep editing Sunday-afternoon
starters after Thursday night. We freeze all eight lineups at once on Thursday. This is
stricter than Yahoo and deliberately so: per-player locks would give models asymmetric
information — a team with a Thursday player would decide with less data than one deciding
Sunday morning — and would need several calls per week. One frozen weekly context is what
makes §8.1's shared `context_hash` meaningful. Disclose it on the methodology page.

**Vercel Cron caveat:** the Hobby plan caps daily cron invocations. If this deploys to
Hobby, either consolidate the jobs or upgrade to Pro before Week 1. Verify during Phase 0 —
this is a silent failure mode that would blow a game week.

Cron auth per `STACK.md`: check `Authorization: Bearer <CRON_SECRET>` in the route handler.

**[NEW] Schedule crons in UTC and account for the DST shift.** Vercel Cron runs on UTC, and
US daylight saving ends **1 November 2026 — in the middle of Week 9.** A cron pinned to a
fixed UTC hour silently moves an hour relative to kickoff at that point. A Thursday lineup
job set to 16:00 UTC is 12:00 ET in October and 11:00 ET in November; the same drift in the
wrong direction would run the job *after* Thursday kickoff and invalidate the week.

Two defenses, use both: schedule every job with **at least four hours of slack** before the
event it must precede, and have each job **assert the current time is before the week's first
kickoff** (from the schedule endpoint, §5.3) and refuse to run if not. A job that would
produce an invalid week must fail loudly rather than quietly write a bad lineup.

### 5.6 Failure handling — **[NEW]**

The retry policy in §8.1 covers a model returning malformed JSON. It does not cover the
provider being down, and this league has hard weekly deadlines with eight external
dependencies. Both need a stated answer, because "we'll deal with it" on a Thursday afternoon
is how a season gets corrupted.

**A model call fails outright** (timeout, 5xx, rate limit, model deprecated mid-season):

1. Retry 3 times with exponential backoff, still inside the job's slack window.
2. If it still fails, apply the **same deterministic fallback as an invalid response** — best
   projected legal lineup, no waiver claims, seed-ordered auction slot — and flag it publicly
   as `provider_failure`, distinct from `fallback_applied` for a model error. A model should
   not be blamed in the standings for its provider's outage, and a reader should be able to
   tell the two apart.
3. Alert immediately. Do not let a silent fallback be discovered at scoring time.

**Sleeper is down when a job runs:** never block on it. Every decision already reads from our
own snapshot (§5.2 gotcha 4), so the lineup job can run on the most recent good snapshot.
Log which snapshot was used. If no snapshot is fresher than 48 hours, fail loudly instead of
setting lineups on stale injury data.

**A job fails entirely and a week is missed:** carry the previous week's lineup forward
unchanged, flag the week as `carried_forward` on the site, and never retroactively invent a
decision the models did not make. A visible gap in the audit trail is recoverable; a
fabricated entry destroys the thing the project is selling.

**A model is deprecated mid-season.** Real risk over 14 weeks with eight providers, and one
the §2 freeze rule does not cover. If a pinned model ID disappears, the team is **frozen at
its last valid lineup** for the remainder of the season and marked as such. Do not substitute
a successor model — a different model finishing the season under the same team name would
make every earlier decision uninterpretable.

---

## 6. Scoring and ranking

### 6.1 Standings

Rank on **all-play** — it removes schedule luck and reads well for spectators.

1. Each week, score every team's nine starters from actual results.
2. **All-play:** each team is compared to the other seven. One win per team it outscores.
   A weekly record runs from **0-7 to 7-0**.
3. **Season rank:** cumulative all-play record. Tiebreaker: cumulative points scored.
4. Also track **total points** as a secondary headline number.

**[NEW] Exact-tie rule.** Two teams can post identical scores — not rare, since kicker and
DEF/ST outputs are small integers. The commissioner is deterministic, so this needs a stated
rule rather than whatever the comparison operator happens to do:

- **All-play: a tie awards half a win to each team.** Records are therefore stored as
  numerics, not integers, and may read 4.5-2.5. Strict `>` would silently punish the tied
  team and `>=` would invent wins from nothing; a half-win is the only symmetric answer.
- **Head-to-head: a tie is a tie**, recorded as W-L-T like a real league.
- **Season rank:** if cumulative all-play *and* cumulative points are both exactly equal at
  season end, the teams are declared co-ranked. No coin flip, no seed tiebreak. With two
  decimal places of points across 14 weeks this should never fire, but leaving it undefined
  is worse than an outcome nobody will see.

#### H2H schedule generation — **[NEW]**

Generate the double round-robin with the **circle method**: fix team 1, rotate the other
seven, and produce 7 unique rounds; weeks 8–14 repeat the same 7 rounds with home and away
swapped. This is deterministic and needs no randomness.

**The pairing order is fixed by the algorithm, but which team occupies which position is
drawn from the pre-registered seed (§8.3)** and published with it. Assigning positions after
seeing auction results would let us — even unintentionally — shape who plays whom when.
Generate the schedule *before* the auction and commit it.

Assert in code that every team plays every other exactly twice and that no team appears twice
in one week. It is a cheap check and a silent schedule bug would corrupt a headline number.

**[NEW] Head-to-head is now a real schedule.** With 8 teams the objection that killed H2H in
v1 disappears — 4 matchups a week, nobody sits. Better still, **8 teams over 14 weeks is
exactly two complete round-robins**, so every team plays every other team precisely twice.
The schedule is perfectly balanced; there is no strength-of-schedule luck at all, only
timing luck (catching a team in a hot week).

That makes H2H far more defensible than it was at 7 teams, and it should be published as a
genuine co-headline rather than a curiosity. **All-play stays the official ranking** — it
removes timing luck too — but where the two disagree, say so loudly. "Kimi is 10-4 in the
head-to-head but 5th on all-play" is exactly the kind of result worth explaining.

### 6.2 Move evaluation — **[NEW, this is "where they made smart moves"]**

Standings say who won. They do not say who *reasoned well*, which is the stated goal. These
are computed by deterministic code every Tuesday and shown per team, per week.

| Metric | Definition | What it isolates |
|---|---|---|
| **Lineup efficiency** | actual starter points ÷ best possible lineup from that roster | Lineup-setting skill, fully separated from draft quality. The single most important metric here. |
| **Points left on bench** | optimal − actual, in points | The human-legible version of the above. |
| **Closest-call outcome** | did the player named in `closest_call` outscore the alternative? | Whether a model's *self-identified* hard call was right. |
| **FLEX delta** | FLEX starter points − best available FLEX | The most discretionary slot, so the most revealing. |
| **Waiver ROI** | points added player scored *for them* − points dropped player scored | Whether a claim actually paid, per dollar bid. |
| **Auction ROI** | points from picks at their slot vs. the league-average slot, against dollars bid | Whether the §4.2 slot purchase was worth what it cost. Settles at season end. |
| **$ per point added** | FAAB spent ÷ net points gained | Budget discipline over the season. |
| **DEF/ST streaming hit rate** | how often their defense beat the median defense that week | Pure matchup reasoning, the skill §3.1 argued for. |
| **Plan adherence** | do this week's moves match the August gameplan (§4.1b)? | Whether a model has a strategy or is just reacting. Deviating is not automatically bad — deviating *without noticing* is. |

**Lineup efficiency is the headline for this project.** A model can draft badly and still
manage brilliantly, and efficiency catches that where total points never would. It is also
the fairest comparison across teams, because it grades each model only against the roster it
actually had.

### 6.3 Calibration — **[NEW]**

Because every decision carries a `confidence` (§4.1a), the season becomes scoreable beyond
wins. Bucket decisions by stated confidence and compare to how often they were right.

A model that says 0.9 and is right 90% of the time is well calibrated. One that says 0.9 and
is right 55% of the time is overconfident — and that is a genuine, publishable finding about
model behavior, independent of whether its team won. It is also the part of this project most
likely to interest people who do not care about fantasy football at all.

Report it as a simple reliability table per model, with the caveat that ~40 lineup decisions
per season is a small sample. Do not over-claim.

---

### 6.4 Win probability — **[NEW]**

Computed by the commissioner in code (§8.4), never by a model.

**Method.** For each team, the starting nine give a projected total `μ = Σ projections`. Each
player's weekly variance `σ²` is estimated from that player's own scored weeks once there are
at least three, and from a **positional prior** derived from the prior season before that.
Treating players as roughly independent — true enough outside QB/WR stacks on the same NFL
team, which get a correlation bump — a team's variance is `σ²_team = Σ σ²_player`, and:

```
P(A beats B) = Φ( (μA − μB) / √(σ²A + σ²B) )
```

**Upgrade once four weeks exist:** switch to Monte Carlo over each player's empirical
distribution. Fantasy scoring is **right-skewed** — a touchdown is a lumpy 6 points — so the
normal approximation understates upset probability, which is exactly the number spectators
care about most. Use the normal form only for Weeks 1–4.

**Publish three things:**

1. **Matchup win probability** for each of the four weekly H2H games. Familiar and punchy.
2. **Expected all-play record** — `E[wins] = Σ P(beat j)` over the other seven. This is the
   more meaningful number, because all-play is what actually ranks (§6.1). A team projected
   at 5.2–1.8 that finishes 2–5 is the week's real story.
3. **Playoff and title odds**, Monte Carlo over the remaining schedule, from Week 6 on.

**Call it "win probability," not "odds."** No money is involved and the moneyline framing
invites a betting read the project does not want. Show it as a percentage.

#### Models never see these numbers — **[fairness line]**

Win probabilities are **spectator-facing only** and must not enter any DATA block.

This is a real line, and worth stating because the spec already feeds models plenty of derived
data — `opp_position_rank_allowed`, `last3_ppg`, positional scarcity curves. The distinction
is between **descriptive** and **predictive**: a stat about what already happened is a fact,
but our estimate of who will win is *our own model's opinion*. Injecting it would mean the
eight models are partly reasoning from our estimator rather than from the shared data, which
quietly corrupts the claim in §8.1 that every difference between them is attributable to the
model itself.

The payoff for keeping the line clean: because models state `confidence` (§4.1a) without ever
seeing our number, **we can compare a model's self-assessed confidence against an independent
objective baseline.** A model that is systematically more confident than the math supports is
a genuinely publishable finding, and it only works if it never saw the math.

### 6.5 Positional rankings — **[NEW]**

Two layers, both deterministic.

**Player positional ranks** — every player ranked within position by points scored, season and
trailing-three-week. Standard fantasy furniture, already needed for the dossier (§4.1b), the
waiver pool (§4.5), and `opp_position_rank_allowed`.

**Team positional strength** — rank all eight teams 1–8 by production from each starting slot:
QB, RB, WR, TE, FLEX, K, DEF. This is the more interesting layer, because it **decomposes a
team's result into where the manager actually succeeded.** "Kimi has the league's best RB
production and is 7th at tight end" says something specific about how a model drafted and
managed that no total-points column can.

Report each position twice:

- **Starter points** — what the team actually banked there.
- **Points left on bench at that position** — separates *roster quality* from *lineup
  decisions*. A team can be 2nd in RB talent and 7th in RB points by starting the wrong ones,
  and that gap is precisely the kind of finding this project exists to surface.

**Tie it back to the gameplan.** Each model declared a `positional_strategy` in August
(§4.1b). Positional strength is how you check it: *"DeepSeek said it would punt tight end and
spend up at receiver — it is 8th at TE and 2nd at WR, so it did exactly what it said and it
is working."* That closes the loop on plan adherence (§6.2) with hard numbers rather than
impressions.

---

## 7. The audit trail — **[NEW, first-class]**

Your stated requirement: *every move a model makes must be documented for humans to review.*
In v1 this was one bullet in §8. Here it is a primary feature with its own schema and UI.

### 7.1 What gets logged, on every single call

```
decisions
  id, season_id, team_id, model_id
  type                 'gameplan' | 'rules_check' | 'auction' | 'draft_pick'
                       | 'lineup' | 'waiver'
  week, round, pick_overall
  prompt_version       'sys-v2'
  rulebook_version     'rulebook-v1'
  dossier_hash         sha256 of the pre-season data pack
  memory_block         the fixed-size continuity block, verbatim (§4.1b)
  reasoning_tokens     where the provider reports them
  system_prompt        full text, verbatim
  user_prompt          full text, verbatim
  context_hash         sha256 of the DATA block
  raw_response         the model's unedited output, before parsing
  parsed_json          post-zod
  valid                bool
  validation_error     text
  fallback_applied     bool   ← the public "model error" flag
  retry_count
  temperature_requested / temperature_honored
  latency_ms, tokens_in, tokens_out, cost_usd
  created_at

  -- reasoning, extracted for querying (§4.1a)
  headline             text
  key_factors          text[]
  closest_call         text
  what_would_change_it text
  confidence           float
  cited_fields         text[]   ← DATA fields detected in key_factors
  unsupported_claims   text[]   ← claims not backed by the DATA block
```

`cited_fields` and `unsupported_claims` are produced by a deterministic post-pass that checks
each `key_factors` bullet against the frozen DATA block. It is a string/number match, not a
model call — §8.4 still holds. This is what turns "the model said it weighed the matchup"
into "the model cited `opp_position_rank_allowed: 28`, and that value is real," and it
catches the failure mode the DATA RULE exists to prevent: a model reasoning from stale
training memory instead of the data in front of it. Surface violations publicly.

`raw_response` is stored **before** any parsing or repair, so a spectator can see exactly
what the model said, including when it emitted markdown fences or prose it was told not to.

### 7.2 How it is published

- `/decisions/[id]` — a raw viewer: system prompt, user prompt, raw response, parsed result,
  validation outcome, cost, latency. Nothing hidden.
- **Git export.** After each weekly job, write `logs/2026/week-NN/decisions.json`,
  `scores.json`, `standings.json` and commit them. Git history is what makes the trail
  tamper-evident — a spectator can `git log` a past week and see it was never edited. This
  is the credibility mechanism, not a nice-to-have.
- `context_hash` is printed on the week page. All eight decisions in a week must share one
  hash. If they do not, the week is flagged — that is the machine-checkable proof that no
  model got different data.

### 7.3 The disagreement view — **[NEW, the flagship page]**

Because all eight models receive a byte-identical DATA block, **every difference in their
output is attributable to the model itself.** That is a rare and genuinely interesting
property, and it deserves the best page on the site rather than a line in the recap.

For each week, one dense grid: rows are the players any team could start, columns are the
eight models, cells show started / benched / not rostered. Then, computed on top of it:

- **Consensus plays** — the seven or eight teams that all started the same player. Boring
  and correct, and worth showing to establish the baseline.
- **Contrarian calls** — a single model benching a player the other seven started, or
  starting one nobody else did. Put each model's `closest_call` text right next to it.
- **The split** — players where the field divided roughly evenly. These are the genuinely
  hard calls, identified by the models' collective uncertainty rather than by us.
- **Resolution** — after Tuesday scoring, mark who was right. A contrarian call that paid
  off is the single best piece of content this project can produce.
- **Same for waivers:** all eight sealed bids on one player, revealed side by side. Eight
  independent valuations of the same asset, with reasoning attached.

This view is what makes the project a reasoning showcase rather than a leaderboard. It
should be linked from the home page, and it is where the weekly share card comes from.

---

### 7.4 Site map — **[NEW]**

v1 had a public-site section; this rewrite lost it, leaving pages scattered across §7.2,
§7.3, and the build order. Since the site *is* the product, here it is in one place.

| Route | Purpose |
|---|---|
| `/` | Standings: all-play record, H2H record, total points, FAAB remaining, auction bid + slot, weekly movement. Links to the current week's disagreement view. |
| `/week/[n]` | Weekly recap: who went 7-0, biggest bust started, biggest bench mistake, plus the `context_hash` proving all eight saw identical data. |
| `/week/[n]/disagreement` | **The flagship page (§7.3).** Consensus, contrarian calls, splits, and resolution. |
| `/team/[model]` | Roster, weekly lineups with reasoning, waiver history with bids and outcomes, lineup efficiency trend, calibration, and its August gameplan pinned at the top. |
| `/team/[model]/gameplan` | The pre-season plan and a running scorecard of plan-versus-actual. |
| `/preseason` | The dossier hash, all eight rules-check scores, all eight gameplans side by side, the auction results with every bid and reasoning. Publish before Week 1 — it is the launch content. |
| `/draft` | Full 120-pick board, each pick's reasoning, and which picks were forced by the round-13 rule (§4.3). |
| `/decisions/[id]` | Raw viewer: system prompt, rulebook, DATA block, unedited response, parsed result, validation outcome, tokens, cost, latency. |
| `/methodology` | The exhibition caveat, the Yahoo alignment matrix (§11), every documented deviation, the conflict-of-interest disclosure (§2), what we deliberately do not equalize (§8.1), and the seed reveal. |
| `/week/[n]/odds` | Win probability per matchup, expected all-play record, and playoff odds (§6.4). |
| `/positions` | Team positional strength 1–8 per slot, starters vs. points left on bench (§6.5). |
| `/week/[n]/wrap` | **The weekly wrap (§7.5)** — short post plus full column, in the beat-writer voice. Feeds the share card. |
| `/logs` | Index into the git-committed weekly JSON exports. |
| `/api/og/week/[n]` | Share card (`@vercel/og`). |

Two notes. **`/preseason` is the launch moment** — eight declared strategies and eight
auction bids, published before a single game, is the most shareable artifact the project has
and it exists weeks before there are any standings to talk about. And **every page showing a
decision links to its `/decisions/[id]`**; the audit trail is only credible if it is one
click from the claim, not buried behind a link labeled "logs."

---

### 7.5 The weekly wrap — **[NEW]**

A Tuesday post in two lengths: a **short caption** for the share card, and a **full column**.
Tone is affectionate ribbing — a friend who watched the same games and is going to bring up
your kicker. Sample voice rendered in `design/look-and-feel.html`.

#### The one real problem: a model writes this, and models compete here

Commentary is not adjudication, so §8.4 is not violated — but two risks are, and both need
mechanical answers rather than good intentions.

**Bias.** If a competitor writes the recap, it is grading rivals. **The beat writer must be a
model that is not in the league.** Pin `mistralai/mistral-medium-3-5` — a lab with no team —
and disclose it in the byline on every post. *(Dependency: if the §2 8th seat swaps from Qwen
to Mistral, the beat writer must move to another non-competing lab.)*

**Fabrication.** A model told to be funny will invent a detail, and one invented stat in a
widely-shared post costs more credibility than the recap adds. So:

1. The writer receives a **deterministically computed facts packet** and nothing else — final
   scores, all-play records, lineup efficiency, points left on bench, the week's biggest bust
   and best start, waiver results with bids, FAAB remaining, the disagreement splits with
   resolution, and **verbatim** `headline` / `closest_call` / `confidence` from that week's
   decisions.
2. **Every number and every quote must come from the packet.** Quotes are verbatim or omitted.
3. A deterministic post-pass checks each number in the output against the packet and **flags
   any figure that does not match** before publication. Same machinery as `cited_fields`
   (§7.1).
4. The recap is logged like any other call — prompt, raw response, cost — and clearly labeled
   commentary with **zero effect on standings**.

#### Where the comedy actually comes from

The funniest material is already in the data and needs no invention: **stated confidence
against outcome**, and `what_would_change_it` against what actually happened. A model that
filed 0.91 confidence and started someone who scored 3.2 has written its own punchline. Point
the writer at that seam rather than asking it to be clever.

#### Tone guardrails, stated in the prompt

- Mock **decisions**, never the model or lab as an entity.
- Punch at outcomes and process, never at capability in a way that reads as a product review.
- Include one **credit-where-due** beat every week. Relentless mockery reads as mean; a friend
  gives you the win when you earn it.
- No invented quotes, no invented stats, no predictions.
- Full column ~400–500 words. The short post ~40.

#### Structure

Headline · the week's story · move of the week · bust of the week · the biggest disagreement
and who was right · FAAB ledger watch · quote of the week · credit where due.

Schema: `recaps (season_id, week, headline, short_post, column_md, facts_packet_hash,
number_check_passed, decision_id)`.

---

## 8. Fairness and honesty

This is the part your project lives or dies on, so it is specified mechanically rather than
as good intentions.

### 8.1 Identical treatment

1. **One frozen context per week**, built once, hashed, sent to all eight. Verified by the
   shared `context_hash` (§7.2).
2. Identical system prompt and identical `prompt_version` across all eight.
3. **Temperature 0.2 requested for all.** Some reasoning-tier models silently ignore or
   clamp temperature — log both `temperature_requested` and what the provider reported, and
   disclose any model that does not honor it.
4. **No tools, no web search, no function calling** in any model call. Every model sees the
   same Sleeper snapshot and nothing else.
5. Identical retry policy: max 2 retries on invalid JSON, same backoff, same for everyone.
6. Identical deterministic fallback rule, and every fallback is publicly flagged as a model
   error rather than quietly repaired.
7. Models are **not told which model they are** or who they are playing. No model sees
   another's roster or reasoning.
8. **[NEW] Identical rulebook, verified.** The same generated League Rulebook (§4.1-iii) is
   in every call, and every model must score 100% on the comprehension check (§4.1b Step 2)
   before its first consequential decision. Equal information is asserted *and tested*, not
   assumed.
9. **[NEW] Identical dossier and equal preparation.** One generated pre-season data pack,
   one hash, all eight models. No model researches independently.
10. **[NEW] Memory parity.** Fixed-size, identically-structured memory block per call
    (§4.1b). No model carries more history than another.
11. **[NEW] Context ceiling.** Total prompt is capped **below the smallest context window in
    the cohort** — Grok 4.5 at 500K — so no model is truncated where others are not. Assert
    it in code and log the token count on every call.
12. **[NEW] Identical output cap.** Same `max_tokens` for all eight, set high enough that
    the bounded reasoning schema (§4.1a) never truncates for anyone.

#### What we deliberately do *not* equalize — **[NEW, state this on the methodology page]**

Two asymmetries are real, unfixable, and part of what is being measured. Hiding them would
be worse than naming them.

- **Latent football knowledge.** These models were trained on different corpora and have
  different amounts of fantasy football embedded in them. We equalize *provided* information;
  we cannot equalize what a model already knows. The DATA RULE pushes reasoning onto current
  data, and §7.1's `cited_fields` check catches decisions that lean on stale memory instead —
  but a model that simply understands football better will do better, and that is a fair part
  of "which model is best at this."
- **Inference compute.** Some of these are reasoning-tier models that think longer before
  answering. We run **each model in its default shipped configuration** rather than clamping
  everyone to a common thinking budget, because the honest question is how these models
  perform as they actually ship, not under an artificial handicap. Log reasoning tokens per
  call so the asymmetry is visible and quantified rather than silent.

The cohort also spans $0.44 to $5.00 per million input tokens (§2). Publish cost per decision
next to results. If an expensive model wins narrowly, readers deserve to price that.

### 8.2 List-order bias — **[NEW]**

LLMs measurably favor items earlier in a list. The `available` array in the draft prompt is
therefore a real bias vector. **Rule:** order it deterministically by `proj_season_points`
descending, identically for all eight models. Equal treatment beats randomization here, and
it keeps every pick reproducible. Disclose the ordering on the methodology page.

### 8.3 Draft slot is earned, not drawn — **[CHANGED by §4.2]**

In earlier drafts of this spec, draft slot was the largest single source of unearned
advantage: assigned at random, worth real points, and impossible to remove in a one-league
format. The best we could do was pre-register the RNG seed so nobody could tamper with it,
and then disclose it as a standing confound.

**The §4.2 auction removes the confound rather than disclosing it.** A team that drafts first
paid for the privilege in a currency that costs it all season. A team that misjudged the
price made a reasoning error, which is exactly what we want to measure — not a coin flip we
have to apologize for.

The seed survives in a much smaller role:

1. Generate the RNG seed **before** the auction. Publish `sha256(seed)` and commit it.
2. The seed is used **only to break ties between equal bids**, and to order fallback slot
   assignment for any team whose auction response failed validation.
3. Reveal the raw seed after the auction. Anyone can verify the hash and replay the tiebreak.
4. Print each team's **auction bid, slot, and remaining budget** on the standings page all
   season, next to its record. The price paid should stay visible next to the result.

What remains a genuine confound, and must still be stated on the methodology page: **the
draft itself has luck in it** — an injury in Week 2 to a first-round pick is nobody's
reasoning failure. Rotated-slot mirrored leagues (§10.2) are still the stronger v2 answer.

### 8.4 The commissioner is code

Scoring, validation, rulings, and fallbacks are deterministic TypeScript. **Never a model
call.** Combined with §2's conflict-of-interest disclosure, this is what keeps the builder
from being able to tilt the result.

### 8.5 Stated limits, on the site

One season. Shared NFL luck. Small sample. Uneven price tiers. Draft-slot confound. A
thought experiment run in public, not a benchmark.

---

## 9. Build order and calendar

**Today is 2026-07-27. NFL Week 1 is early September. The draft is the deadline — roughly
five weeks.** Everything after the draft lands week by week once games are played.

| Phase | Work | Gate |
|---|---|---|
| 0 | Next.js + Supabase + `CLAUDE.md`, schema migrations, `.env.local.example`, verify Vercel Cron limits | Repo deploys |
| 1 | Sleeper ingest → players, projections, ADP, snapshot + hash | Player pool queryable in Postgres |
| 2 | OpenRouter adapter, **one** model call end to end, strict zod parse, decision logged | One row in `decisions` with a raw response |
| 3 | Fan out to all eight, validation + deterministic fallback | 8 valid parsed responses, fallbacks flagged |
| 4 | **[NEW] 2025 backtest dry run** — replay the full pipeline on the completed 2025 season | Scoring math verified; **auction shows bid dispersion (§4.2)** |
| 5 | **Rulebook generator, dossier, comprehension check, gameplan calls** | ⚠️ **All 8 score 100% on the rules check** |
| 6 | **Slot auction engine**, then draft engine + roster storage. **Run and freeze both** | ⚠️ **Hard deadline: before Week 1** |
| 7 | Weekly lineup job, scoring job, all-play + H2H ranking | Week 1 scores correctly |
| 8 | **Waiver job:** bid calls, deterministic FAAB resolution, roster mutation | A claim is won, budget debited, roster updated |
| 9 | **Move evaluation + calibration** (§6.2, §6.3), **win probability + positional strength** (§6.4, §6.5) | Lineup efficiency and a Week 2 win probability both compute |
| 10 | Public site: standings, team pages, draft board, **disagreement view**, gameplan-vs-actual, decision viewer, recap | Site live |
| 11 | **Weekly wrap:** facts packet, beat-writer call, number check | A column publishes with every figure verified |
| 12 | Share card, methodology page, seed reveal | Growth loop live |
| 13 | **[NEW] Syndication to X** (§13) — launch run, weekly wrap post, contrarian resolutions | A post publishes with every figure verified against the facts packet |

**Phases 8 and 9 can land after Week 1.** Only Phases 0–6 are gated by the draft deadline.
Waivers do not matter until there is a Week 1 result to react to, and move evaluation is
retrospective by definition. If the calendar tightens, ship the draft on time and let these
follow — but do not cut them, because together with §7.3 they *are* the reasoning showcase.

**Why Phase 4 exists.** The draft is one-shot and irreversible — a bug in the scoring
constants or the fallback path discovered in Week 3 is unfixable without invalidating the
season. The 2025 season is complete and fully available from the same endpoints, so we can
run the entire engine against it, check our PPR math against known results, and shake out
JSON-parsing failures per model *before* anything is frozen. It is cheap insurance and it
also produces launch content.

**Cost estimate:** 24 pre-season calls (rules check, gameplan, auction) + 120 draft picks +
(8 models × 14 weeks × 2 decisions) + 14 weekly wraps = **382 calls**. Prompts stay small and the structured reasoning fields are bounded. Well under
**$40 for the entire season** across all eight models. The auction adds 8 calls and is, per
dollar, the highest-value content in the project.

---

## 10. Later, once the POC lands

1. **Trades between AI teams, starting with a pre-draft slot market.** The richest reasoning
   artifact left, and the only interactive element — a trade requires modeling another
   model's valuations, not just the player pool. Considered for v1 and deferred on
   calendar risk, not on merit. The designed-but-unbuilt version:

   - Assign slots **randomly** rather than by auction. A random allocation is deliberately
     inefficient, which is what gives a trade market real work to do; an auction already
     lands near-efficient and leaves little to bargain over.
   - Keep a **private valuation call** — each model prices all 8 slots in FAAB without
     bidding. Preserves the comparable eight-way dataset and, more usefully, gives the
     ground truth to judge trades against. *A model that valued slot 1 at $45 and then
     traded it for $10 is visibly incoherent*, which is a sharper finding than any sealed
     bid produces.
   - **One bounded round:** simultaneous sealed offers (`target_team, my_slot, their_slot,
     faab_offered`), then one acceptance call each. Conflicts resolve by seed. No free-text
     chat, fully deterministic.
   - **Counterparties stay anonymous** ("Team C", not "Kimi K3") so §8.1's isolation rule
     survives and no model tailors behavior to a specific rival.
   - **Only enforceable things trade:** slots, FAAB, waiver priority. Not *"I won't bid on
     RBs in round 3"* — an unenforceable side deal creates a shadow rulebook the
     commissioner cannot adjudicate.
   - It also **fails safe**: if the trade round breaks, random order stands and the league
     still works. The auction by contrast is load-bearing.

   Risks that deferred it: order effects demand simultaneous offers, valuations may converge
   and deadlock into a no-op, and it puts an untested protocol in front of an irreversible
   draft. Build it against the 2025 backtest first.
2. **Mirrored leagues with rotated draft slots**, ranked by average. This is the upgrade
   that turns the exhibition into a defensible ranking by cancelling the §8.3 confound.
3. Confidence intervals and a past-season backtest for a stronger "best manager" claim.
4. **Expansion to a Yahoo-default 10 teams.** Two more seats would match Yahoo's default
   league size and thin the pool further. Verified available on OpenRouter:
   `z-ai/glm-5.2`, `minimax/minimax-m3`, `mistralai/mistral-medium-3-5`.
5. **Individual defensive players (IDP)** — the natural next depth step now that team
   defense is in. Sleeper carries the tackle and sack fields for it.
6. **Open free agency** between waiver runs, if v1's weekly-only cadence proves too rigid
   (see §4.5 rule 6).
7. **A model's-eye retrospective** — at season end, show each model its own season and ask
   what it would do differently. Pure content, zero effect on standings, and the most
   direct expression of the reasoning-showcase goal.

---

## 11. Yahoo alignment matrix

Where we match Yahoo's documented defaults and where we knowingly depart. Publish this
table on the methodology page — "Yahoo rules except where noted, and here is exactly what
is noted" is a much stronger claim than a hand-wave at realism.

| Rule | Yahoo default | Ours | Match? |
|---|---|---|---|
| Passing yd / TD | 1 per 25 / 4 | same | ✅ |
| Rushing & receiving yd / TD | 1 per 10 / 6 | same | ✅ |
| Interception | −1 | −1 | ✅ |
| Fumble lost | −2 | −2 | ✅ |
| 2-pt conversion | 2 | 2 | ✅ |
| Return TD | 6 | 6 | ✅ |
| Reception | 0.5 | **1.0** | ⚠️ variance reduction, §3.2 |
| Kicker scoring | 3 / 4 / 5 / 1 | same | ✅ |
| DEF/ST scoring | sacks, turnovers, pts-allowed scale | same | ✅ |
| Starting lineup | 9 incl. K + DEF | **9 incl. K + DEF** | ✅ |
| Roster size | 15 | **15** | ✅ |
| Bench | 6 + 2 IR | **6, no IR** | ⚠️ IR is inert without waivers |
| Draft rounds | 15 | **15** | ✅ |
| League size | 10 teams | **8 teams** | ⚠️ one seat per lab |
| Ranking | Head-to-Head Points | **All-play primary, H2H published** | ⚠️ H2H is a real balanced schedule at 8 teams, §6.1 |
| Draft | Snake | Snake | ✅ |
| Draft order | Random or commissioner-set | **Won at sealed-bid auction** | ⚠️ deliberate departure, §4.2 |
| Waivers | Rolling list default, FAAB optional | **FAAB, in v1** | ⚠️ FAAB forces explicit valuation, §4.5 |
| FAAB budget | $100, non-replenishing | **$100, non-replenishing** | ✅ but also funds the slot auction, §4.2 |
| FAAB tiebreak | Continual rolling list | Continual rolling list | ✅ |
| Waiver priority seed | Reverse draft order | Reverse draft order | ✅ |
| Waiver period | 2 days | Weekly cycle | ⚠️ freeze never binds, §5.5 |
| Open free agency | Yes, between waivers | *v2* | ⏳ §10.6 |
| Trades | Yes, 2-day rejection window | *v2* | ⏳ §10.1 |
| Lineup lock | Per player, at game start | **Weekly, Thursday** | ⚠️ fairness, §5.5 |
| Stat corrections | Until next week's first game | Same window | ✅ |
| Playoffs | Weeks 16–17, 4 teams | **Weeks 15–16, 4 teams, H2H bracket** | ⚠️ we skip Week 17 — NFL starters rest, §3.3 |
| Season | Sept 2026 – Jan 2027 | Weeks 1–14 + playoffs | ⚠️ |

**On head-to-head.** Moving to 8 teams removed the structural objection — no byes, and a
perfectly balanced double round-robin (§6.1). H2H is now a legitimate Yahoo-faithful format
here, not a broken one.

It still should not be the *official* ranking. A balanced schedule removes
strength-of-schedule luck but not timing luck: a team can post the second-highest score of
the week and lose because it drew the one team that went off. All-play removes both.

**So publish both, with all-play as the ranking and H2H as a full co-headline** — a real
standings column, not a footnote. Where they disagree, lead with it. "Kimi is 10-4 head-to-
head but 5th on all-play" is a better story than either number alone, and it teaches the
reader something real about variance. Best of both, with the honest one load-bearing.

---

## 12. Design system — **[NEW]**

Direction: **16-bit console sports broadcast, Genesis-era Madden.** Live mockup with sample
data: `design/look-and-feel.html`.

**The organizing idea: the retro treatment is a broadcast *wrapper*, and model reasoning sits
inside it presented plainly** — a telestrator overlay on a game feed. Chrome, tables, and
scores get the full period treatment; the reasoning cards deliberately break the spell with a
light ground and a humanist sans. That tension is specific to this project — 16-bit packaging
around machine text — and it keeps the payload readable, which matters because the reasoning
*is* the product (§1).

#### Palette

Neutrals are biased green toward the turf rather than left as grey.

| Token | Hex | Role |
|---|---|---|
| `--pitch` | `#071A12` | Ground. Near-black with a green cast. |
| `--steel` / `--panel` | `#0D2419` / `#12301F` | Raised surfaces. |
| `--turf` / `--turf-lo` | `#10743C` / `#0B5B2E` | Structure, table headers, field motifs. |
| `--chalk` / `--chalk-dim` | `#EDF2E6` / `#8FA694` | Type and secondary type. |
| **`--amber`** | **`#FFC02E`** | **The single accent — scoreboard LED.** Winners, ranks, live state, focus rings. Nothing else. |
| `--good` / `--bad` | `#3FD07A` / `#E8402A` | Semantic only, kept separate from the accent. |

#### Type

Three roles, all from system stacks — the artifact CSP blocks font CDNs and a silent
fallback would wreck the identity.

- **Display** — `Impact, Haettenschweiler, "Franklin Gothic Heavy"`. Scores, team names,
  headings. Genesis-era Madden UI was bold condensed sans, *not* 8-bit pixel type; reaching
  for a pixel font would be the wrong decade.
- **Data** — monospace with `font-variant-numeric: tabular-nums` on **every** figure in the
  league. Columns of numbers that shift width read as broken.
- **Reading** — humanist sans, on the light telestrator ground, for model reasoning only.

#### Rules

1. **Zero border-radius anywhere.** 3px borders, hard `5px 5px 0` offset shadows, no blur.
2. **Yard-line dividers** between sections; hash-mark gradients as the field motif.
3. **A fixed HUD score-bug bar** across the top, as in-game.
4. **A CRT scanline veil** over the page at ~16% opacity. Static, not animated.
5. **Single theme, committed.** A stadium-night CRT does not have a light mode; inverting it
   would produce a worse page, not a considerate one. This is a deliberate choice, not an
   omission — and it is the one place the project departs from theme-aware defaults.
6. Any motion (the live-indicator blink) respects `prefers-reduced-motion`.
7. Every wide table scrolls inside its own container so the page body never scrolls sideways.

#### Screen vocabulary

The retro sports frame maps onto this project's content without forcing:

| Page | Treatment |
|---|---|
| Standings (§7.4 `/`) | The stat screen. Dense, tabular, amber for the leader. |
| Week recap | The scoreboard strip — four H2H game panels. |
| Disagreement board (§7.3) | **The play-call chalkboard.** Field-grid background, ST/BN/— cells, near-even splits highlighted in amber. |
| Decision record (§7.2) | The telestrator card. Light ground, plain type, cited fields in `code`. |
| Draft board | The draft-class screen, 120 picks. |

**Open:** wordmark and favicon. Impact-set type works as a placeholder but a real
custom-lettered mark would carry the identity further.

---

## 13. Syndication to X — **[NEW]**

The site is the product, but nobody arrives at a URL unprompted. This is the
distribution step, and **most of it already exists in this spec** — §7.5 produces a
~40-word `short_post` explicitly designed as a share-card caption, and §7.4 has
`/api/og/week/[n]` rendering the card. What was never specified is where either goes.

### 13.1 What gets posted

Three kinds of post, in descending order of how much they earn their place:

1. **The pre-season launch run.** Eight declared gameplans and eight auction bids,
   published before a single game. §7.4 already calls `/preseason` the launch moment;
   it is the most shareable artifact the project has and it exists weeks before there
   are standings to talk about.
2. **The weekly wrap**, Tuesday — `short_post` plus the share card, linking to
   `/week/[n]/wrap`.
3. **Contrarian resolutions**, opportunistically. "Seven teams started him. One
   benched him. Here is what happened." This comes straight from the disagreement
   view (§7.3), which is the best content this project produces, and it is the only
   one of the three that should be allowed to skip a week when nothing interesting
   happened.

### 13.2 Cost — **[verified 2026-07-28]**

X moved to pay-per-usage: **$0.015 per post, $0.200 per post containing a URL**, no
subscription and no free allowance. At roughly 14 weekly posts plus a launch run and
occasional resolutions, the season lands **under $10** — negligible against the ~$40
model budget (§9).

Note the 13× premium on posts with links. It does not matter at this volume, but if
posting ever scales, put the link in a reply rather than in the post body.

### 13.3 The risk this adds, and the mechanism against it

§7.5 already worries that "one invented stat in a widely-shared post costs more
credibility than the recap adds." **Syndication makes that failure mode strictly
worse**, for two reasons that need mechanical answers rather than good intentions:

1. **A post leaves its context behind.** On the site, the wrap sits under the §1
   exhibition caveat with a link to the raw decision one click away. Screenshotted on
   X, it is just a claim about a named commercial product. The tone guardrails in
   §7.5 — mock decisions never the model or lab as an entity, punch at outcomes never
   at capability — stop being stylistic and become the thing that keeps this from
   reading as a product review of eight companies' flagships.
2. **A post is not really retractable.** Deleting it does not unscreenshot it.

**Therefore:**

- **The §7.5 number check is a hard gate, not a warning.** If any figure in the post
  fails to match the deterministic facts packet, nothing is posted and the failure
  alerts instead. A missed week is recoverable; a wrong stat under the project's own
  name is not.
- **Every post links back**, so the caveat and the audit trail are always one tap
  from the claim.
- **The byline discloses the writer.** The wrap is written by a non-competing model
  (`mistralai/mistral-medium-3-5`); posts say so, exactly as §7.5 requires of the
  site.
- **A kill switch.** One env var stops all syndication without a redeploy.

### 13.4 Publish gate — **[OPEN]**

Whether posts go out automatically or wait for approval is a genuine choice, and it
is the account owner's to make, not the builder's:

- **Approval gate (recommended, at least for the first weeks).** The job generates
  the post and card, stores them `pending`, and notifies. A human taps approve. Costs
  a few minutes a week and makes the tone calibratable against real reactions before
  it runs unattended.
- **Fully automatic.** Defensible *only* once the number check has been observed
  catching things and the voice has settled. The failure mode is unattended.

Recommendation: start gated, move to automatic mid-season if the wrap has earned it.

### 13.5 Schema and placement

```
social_posts  id, season_id, week, kind ('launch'|'wrap'|'resolution'),
              body, card_url, target_url, status ('pending'|'approved'|'posted'|'blocked'),
              number_check_passed, blocked_reason, external_id, posted_at, decision_id
```

**This is Phase 13 and it is downstream of Phases 11 and 12** — there is nothing to
post until the wrap and the share card exist. The one exception is the launch run,
which fires before Week 1 and needs only `/preseason`.

---

## Open items to close before building

**Resolved:** ~~starting seven or nine~~ (full Yahoo nine, 15-man roster, 15 rounds) ·
~~team count~~ (**8**) · ~~waivers in v1~~ (**yes, FAAB**) · ~~shared budget~~ (**$100**,
measured — best-to-worst slot spread is only 58.7 pts a season, §4.2) · ~~equal knowledge and
preparation~~ (**rulebook + dossier + comprehension gate + gameplan**, §4.1 and §4.1b).

**Closed in the audit pass:** ~~bye-week source~~ (derived + validated, §5.3) ·
~~playoff mechanics~~ (§3.3) · ~~exact-tie rule~~ (§6.1) · ~~H2H schedule generation~~ (§6.1) ·
~~provider/outage failure handling~~ (§5.6) · ~~draft roster legality~~ (§4.3) ·
~~cron DST drift~~ (§5.5) · ~~dossier size~~ (§4.1b) · ~~site map~~ (§7.4).

Remaining, none of which block starting Phase 0:

1. **The comprehension-check question set (§4.1b Step 2).** Six examples are drafted; the real
   set wants ~12, covering every rule that can change a decision, each with one objectively
   correct answer computed from the rulebook config. Worth writing carefully — it is the
   fairness gate, and an ambiguous question would discredit it.
2. **8th seat — Qwen3.7 Plus or Mistral Medium 3.5?** Qwen is the stronger model and matches
   the "current flagship per lab" rule. Mistral is weaker but gives the cohort a European
   lab instead of a third Chinese one. Defaulting to **Qwen**; say the word to swap. §2
3. **§3.2 — confirm full PPR over Yahoo's half-PPR.** Recommended, reasoning in §3.2.
4. **§4.5 rule 6 — open free agency in v1, or waivers only?** Defaulting to **waivers only**,
   which keeps every acquisition a bid with reasoning attached. Open FA would let a model
   grab a player for free with no valuation, which is realistic but less legible.
5. **§5.5 — Vercel plan.** Confirm cron limits support a daily ingest + **five** weekly jobs.
   The Hobby tier will not cover this; budget for Pro.
6. **Draft date.** Late August 2026, after NFL roster cuts. The 2026 season opens
   **2026-09-09** (confirmed from the schedule endpoint), so this is about six weeks out.
7. **Domain / project name.** "Gridiron Gauntlet" is the working name; rename freely.
