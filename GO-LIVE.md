# What "fully live and automated" means, and how to know we are there

**Written 10 August 2026.** `TODO.md` tracks *what is left*. This file defines *what done
looks like* — five gates, each with a condition you can check rather than believe.

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

- [ ] Migration `0008_season_projection_uniqueness.sql` applied
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

- [ ] Migration `0007_social_posts.sql` applied
- [ ] X developer app created for `@playATW`, credits purchased, four env vars set
- [ ] X adapter + `/api/cron/social` built
- [ ] A post auto-releases when its checks pass, and is held when they do not

**Passing looks like:** `social_posts` rows moving `draft → posted` on their own, and a
row with `auto_eligible = false` sitting untouched with a `hold_reason`.

> Cost is pay-per-use, ~$14 for the season. The free tier closed to new developers on
> 6 February 2026.

---

## Gate 4 — It finishes itself 🔵 *late November*

The regular season is complete and unaffected; the playoffs are not wired at all.

- [ ] Weeks 15–16 reachable by the forward-looking jobs (they cap at week 14 today)
- [ ] Playoff lineups set, playoff weeks scored
- [ ] §14.5 playoff FAAB pool run — `playoff-pool.ts` is written and tested, and nothing
      calls it
- [ ] A champion declared, and the site says who

**Passing looks like:** a week-16 row in `standings` and a result on the front page.

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

## Honest status, 10 August 2026

| Gate | State |
|---|---|
| 0 — Deployed and guarded | ✅ |
| 1 — The league exists | 🔴 draft not run |
| 2 — A week runs unattended | ⬜ blocked by 1 |
| 3 — It publishes itself | 🟡 composer + queue built, credentials outstanding |
| 4 — It finishes itself | 🔵 not started, due late November |

**Two full weekly cycles have been rehearsed** against 2025, ten bugs found and fixed.
The machine works. It has never been asked to run a week that counts.
