# What "fully live and automated" means, and how to know we are there

**Written 10 August 2026, status re-verified 16 August.** `TODO.md` tracks *what is left*.
This file defines *what done looks like* — five gates, each with a condition you can check
rather than believe.

---

## First, the distinction that matters

**Automated** here does not mean "no human ever touches it". It means:

> **No human action is required for the league to run correctly.** Lineups get set,
> waivers resolve, weeks get scored, standings update, and the season reaches a champion
> whether or not anybody is watching.

Two things stay human **on purpose**, and they are not gaps to close:

| Human step | Why it stays |
|---|---|
| Releasing the weekly column (`recaps.published`) | It is a byline piece. The number check can flag a wrong figure; it cannot fix one. Week 5 of the rehearsal shipped a draft asserting DeepSeek "fell to" GPT-5.6 Sol when DeepSeek won. |
| Releasing the weekend guide (`weekend_guides.published`) | Same reason, same table pattern. |

Nothing that affects a **result** waits on a human. Everything that affects a **byline**
does. If that ever inverts, something has gone wrong.

---

## Gate 0 — Deployed and guarded ✅ *(10 Aug)*

The machine exists, is deployed, and refuses to act when it has nothing to act on.

- All eight cron routes exist and return 401 unauthenticated
- Every model-calling job skips cleanly on a season that has not started
- No route 500s pre-draft
- The kickoff guard clears every week of 2026, tightest margin 4.0h

```bash
npx tsx --env-file=.env.local scripts/weekly-dry-run.ts --status
npx tsx --env-file=.env.local scripts/weekly-dry-run.ts --crons --season 2026
```

**Passing looks like:** three `present` lines in the schema block, and
`Every forward-looking job clears its week with margin to spare.`

---

## Gate 1 — The league exists 🔴 *blocks everything below*

- [x] Migration `0008_season_projection_uniqueness.sql` applied *(14 Aug)* — and verified
      by attempting a duplicate season-long insert, which came back `23505`. An index
      that exists but does not fire is the same as no index.
- [x] Migration `0009_playoff_seeds.sql` applied *(14 Aug)* — present, anon-readable.
- [x] **Rulebook version reconciled** *(14 Aug)* — `seasons.rulebook_version` is now
      `rulebook-v3`, matching what the generator stamps on every prompt. `draft.ts`
      refused both stages until this agreed, which is the guard working.
- [x] **Comprehension check re-sat under v3** *(14 Aug, $0.17)* — **8/8 at 19/19, every
      one on the first attempt**, including the four models pinned that morning and both
      new playoff questions. Shared context hash `c69d1c8d…`.
- [ ] Auction run — 8 slots assigned, seed verified against the published commitment
- [ ] Draft run — 120 picks, 8 rosters of 15

```bash
npx tsx --env-file=.env.local scripts/draft.ts --status
```

**Passing looks like:** `auction 8/8 slots assigned`, `draft 120/120 picks`.

> The auction is the irreversible half. Draft slots are what every anonymous rival label
> is derived from all season — `Team A` through `Team H` are stable for fourteen weeks
> *because* they come from draft slot. Once it commits, that mapping is fixed. The draft
> itself is resumable; it writes a row per pick and continues where it stopped.

---

## Gate 2 — A week runs unattended 🔵 *the real test*

Everything before this is rehearsal. This is the first week that happens without anybody
starting it.

- [ ] One full Tuesday→Thursday cycle fires on cron with no human intervention
- [ ] `job_runs` shows `completed` for every weekly job that week
- [ ] `/results/{week}` renders scores, standings, efficiency and the luck lines
- [ ] The standings on the front page move

```sql
select job, status, model_calls, cost_usd, detail
from job_runs where week = 1 order by started_at;
```

**Passing looks like:** seven rows, all `completed`, no `running` left behind.

> A row stuck in `running` means a job died mid-flight. It deliberately blocks
> re-delivery — re-running a half-spent job is worse than not running it — so that is the
> one state that needs a human to look.

**Watch on the first live week specifically:**

- `lineups` has two cron entries and must stand down on the Wednesday one. Week 1 of 2026
  opens on a **Wednesday**, so week 1 is the exception where the Wednesday run is the one
  that counts.
- Vercel cron delivery is best effort. A missed `lineups` fire is survivable — every team
  already has a deterministic lineup seeded before the first model call — but it should
  be noticed, not discovered in the scores.

---

## Gate 3 — It publishes itself 🟡

- [x] Migration `0007_social_posts.sql` applied *(it already was — the 10 Aug entry was
      wrong; `social_posts` is present, verified 14 Aug)*
- [x] **X adapter + `/api/cron/social` built** *(14 Aug)* — OAuth 1.0a signing with 13
      tests, a daily 20:00 UTC cron entry, compose-then-release with a per-run cap of 3.
      Runs and skips cleanly with no credentials, queueing drafts either way.
- [x] **X app connected as @PlayATW** *(14 Aug)* — four env vars set locally and on
      Production, verified end to end by posting. `scripts/x-check.ts` reports the handle
      the tokens belong to, which is the thing worth checking before a season of posts
      goes out under the wrong name.
- [x] **Text only, "link in bio"** *(14 Aug)* — X charges $0.20 for a post carrying a URL
      against $0.015 without. The season drops from about $8 to about $0.60.
- [ ] A post auto-releases when its checks pass, and is held when they do not — the queue
      runs daily and has had nothing fresh to say yet

> **Two traps in the portal.** App permissions must be **Read and write** and the access
> token must be **regenerated afterwards** — a token minted before the change keeps its
> read-only scope and returns a 403 that does not mention permissions. And the token
> belongs to whichever account was signed in when it was generated, which is the byline
> on every post for the season. The **Bearer token is app-only and cannot post.**

**Passing looks like:** `social_posts` rows moving `draft → posted` on their own, and a
row with `auto_eligible = false` sitting untouched with a `hold_reason`.

> Cost is pay-per-use, ~$14 for the season. The free tier closed to new developers on
> 6 February 2026.

---

## Gate 4 — It finishes itself ✅ *built and rehearsed 14 Aug*

- [x] **Weeks 15–16 reachable by every job** — the week-14 cap is gone from
      `resolveScoringWeek`, `upcomingWeek`, the lead-time guard and the daily projection
      ingest. `LAST_LEAGUE_WEEK` is now the single bound.
- [x] **The bracket** — `src/lib/engine/bracket.ts`, 20 tests. 1v4 and 2v3 in week 15;
      the winners meet for the title and the losers play for third in week 16.
- [x] **Playoff lineups** — the lineup job derives and persists the week's fixtures, then
      asks only the teams still playing. Eliminated teams are not seeded a lineup.
- [x] **§14.5 playoff FAAB pool run** — it is the Tuesday `waiver-bids` job, not a new
      route: freeze the field, release the four eliminated rosters, then the same sealed
      bids among the four survivors, resolved by the same Wednesday job.
- [x] **A champion declared, and the site says who** — `/results/15` and `/results/16`
      render (they would have 404ed), with round labels and seeds, and the front page
      carries the title beside the sentence that stops it overwriting the ranking.
- [x] **Rehearsed against 2025** *(14 Aug, $0.80)* — field seeded, pool released, four
      survivors bidding, two bracket weeks set and scored, champion declared. Three bugs,
      all found by running it: applying `0008` had broken the daily ingest's WEEKLY write
      (a partial index cannot be an `ON CONFLICT` target, and only the seasonal write was
      converted), the dry run **froze the field** because `decidePlayoffField` wrote on
      every call, and `/results/15` announced the champion a week before it was decided.
      8/8 valid lineups across both bracket weeks, zero fallbacks, and the standings
      correctly stopped at 14 — the bracket did not re-seed itself from its own results.

**Passing looks like:** `/results/16` naming a champion the `lineup_scores` agree with.
*(It did, on 2025: Muse Spark 1.1 arrived at the pool a 4 seed with $80 unspent, spent all
of it, and won the title 158.6–151.4.)*

> **The standings deliberately do NOT reach week 16.** Accumulating a playoff week would
> fold four teams' scores into an eight-team all-play record and move the very ranking
> the bracket was seeded from. `standingsThroughWeek` caps it at 14 and there is a test
> asserting the leader would otherwise change.
>
> **The field is frozen when the pool runs**, in `playoff_seeds`, because the pool runs on
> Tuesday's PROVISIONAL week-14 scores and the final pass lands on Thursday. A team
> cannot be told on Thursday that the roster it rebuilt on Wednesday was for a playoff
> run it is not in. A later correction changes the published numbers, never the bracket.

---

## The five things that would break automation, and what guards each

This is the part worth re-reading in October.

| Failure | Guard | How it is checked |
|---|---|---|
| A job spends twice on a duplicate cron delivery | `job_runs` claimed **before** the first model call | 13 tests; proven in production on the weekend guide |
| A job runs after kickoff and invalidates a week | `assertBeforeKickoff`, ≥4h slack, DST-aware | `--crons` prints every week's margin |
| A job runs weeks early on stale data | lead-time guard, refuses beyond 7 days | 7 tests, including the preseason case |
| A model fails and a team scores zero | Deterministic lineups seeded **before** any model call | The worst case is a week decided by code and publicly marked as such |
| A model is blamed for our own limits | Every rejection annotated on the decision row | Three of eight rehearsal bugs were exactly this |

---

## Honest status, 16 August 2026

Verified against the database rather than against this file — `draft.ts --status`,
`weekly-dry-run.ts --status --crons`, and `db-check.ts`, all re-run on 16 August.

| Gate | State |
|---|---|
| 0 — Deployed and guarded | ✅ 29/29 tables, RLS correct, every week clears its kickoff |
| 1 — The league exists | 🔴 **only the auction and draft remain** — schema, rulebook and the 19/19 gate are all done |
| 2 — A week runs unattended | ⬜ blocked by 1, and by there being no football until 9 Sept |
| 3 — It publishes itself | 🟡 @PlayATW connected and proven by hand; the queue has never auto-released, because `social_posts` has nothing in it yet |
| 4 — It finishes itself | ✅ built and rehearsed 14 Aug, champion declared |

**Three full cycles have now been rehearsed** against 2025 — two regular-season weeks and
the whole postseason — for $2.83. **Sixteen bugs found and fixed**, four of which would
have ended the season. The machine works. It has never been asked to run a week that
counts.

### The remaining work is not code

Outside the draft, there is nothing left to build. What is left needs either the draft or
real football to exist:

| Left | Needs | Earliest |
|---|---|---|
| Gate 2 — an unattended weekly cycle | rosters, and a week to run | Week 1, **9 Sept** |
| Gate 3 — a post auto-releasing | a result worth announcing | first scored week |

> **Week 1 is the Wednesday-opener exception.** It kicks off Wed 9 Sept 19:00 ET, so the
> Wednesday `lineups` firing is the one that counts and the Thursday one must stand down.
> It is also the tightest margin of the season — 4.0h for the weekend guide, exactly the
> required minimum. If any week is going to expose a scheduling assumption, it is this one.

### The eval, added 14 August

`/ratings` scores the models on decisioning rather than luck: **points added over the
deterministic manager** — the projection sort the crons already run as a fallback. Same
roster, same week, same outcomes, so the variance cancels and what survives is what the
model chose. Plus a calibration board on their stated win probabilities.

Against the 2025 rehearsal, six of eight models have a lineup delta of **exactly zero** —
they do not deviate from the projection-optimal lineup at all. Two weeks concludes
nothing, but if it holds over fourteen it is the most interesting finding here.

### What changed on 14 August

Everything except the draft. The playoff phase was built four months early rather than in
late November, and doing it now paid for itself immediately: the bracket needed two rules
stated in the rulebook that were enforceable but unstated, and **a rulebook change is free
before the draft and expensive after it.** In November that bump would have landed
mid-season, with 120 picks and ten weeks of decisions already taken under v2.
