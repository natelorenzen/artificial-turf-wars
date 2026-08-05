# What's left before the season runs

**Written 1 August 2026, updated 5 August.** Draft is late August (~3 weeks out). NFL
Week 1 kicks off **9 September 2026** (~5 weeks out).

State as verified against the database and the repo on 5 August, not from memory:

- 2026 season: **8 teams seeded, rules check passed 8/8, and nothing else.** 0 auction
  bids, 0 draft picks, 0 rosters, 0 lineups. **The draft has not been run.**
- 2025 rehearsal: complete. 120 picks, 128 decisions, $4.99 spent, three gates met.
- Site: live, four findings posts, the weekend guide, FAQ, feed, llms.txt, sitemap.
- `vercel.json` declares **8 cron schedules**; **5 routes exist** (was 1).

---

## What shipped on 4–5 August

Five PRs (#10–#14). Roughly $1.10 of model spend.

- **Findings 004** — eight models previewed a preseason game from memory alone and all
  coin-flipped it, 0.50–0.53, without inventing a roster. Live.
- **`scripts/draft.ts`** — the guarded 2026 draft runner. Four locks plus seed-commitment
  verification. Dry-run against live data; **not fired**.
- **Four cron routes** — `score-provisional`, `score-final`, `waiver-resolve`,
  `weekend-guide`.
- **`job_runs` idempotency ledger** — claimed before the first model call, so a duplicate
  cron delivery cannot spend twice. Migrations `0003`, `0004`, `0005`.
- **The Thursday weekend guide** — 32 model takes across four games, assembled by the
  non-competing beat writer, published at `/weekend`.

### Bugs found and fixed along the way, worth remembering

- **`CCRON_SECRET`** — a one-character typo in Vercel meant `process.env.CRON_SECRET` was
  undefined in production. **Every cron job had been 500ing before doing any work since
  the first deploy**, including the daily ingest, silently. Fixed and verified 401.
- **Seven queries would have corrupted the draft pool.** They read `player_projections`
  filtered only by season, with no week filter — including the dossier sent to every
  model before the draft. Once weekly rows existed, every player would have appeared once
  per ingested week. All seven now filter `week is null`.
- **The weekend guide could never have finished in production.** 33 sequential model calls
  against a 300s function ceiling. Now parallel across models (170s), resumable, and
  persisted per game.
- **`db-check.ts` could not detect a missing table** — PostgREST answers a head-count on a
  nonexistent relation with no error and `count: null`, so a completely unapplied schema
  reported as "28/28 tables present".

---

## 🔴 Critical path — the season cannot run without these

### 1. Draft runner for the real season

**The biggest gap, a hard deadline, and irreversible once fired.**

The engine already exists and is tested (`src/lib/engine/auction.ts`,
`draft-runner.ts`, `schedule.ts`), and `scripts/backtest.ts` has working auction, seed
and draft stages — but they are hardcoded to `SEASON = 2025`.

What is missing is a separate, guarded `scripts/draft.ts` for 2026.

> **Do not just parameterise `backtest.ts` with `--season`.** A script named "backtest"
> that can write the real season is one stray flag away from destroying a one-shot
> event, four weeks before that event. Duplicating ~250 lines of DB plumbing is the
> cheaper risk. Revisit after the draft, not before.

Guards it needs: refuse to run without `ALLOW_IRREVERSIBLE`, refuse if the season
already has picks, print a plan and require explicit confirmation before writing.

- [x] Build `scripts/draft.ts` — auction → draft, season 2026, guarded *(4 Aug)*
- [x] Dry-run against 2026 data with no writes *(4 Aug)*
- [ ] Run the real auction (8 model calls, ~$0.20)
- [ ] Run the real draft (120 model calls, ~$5–10)

Four locks stand between an invocation and a write: `--commit`, `ALLOW_IRREVERSIBLE=1`,
`--i-understand=2026`, and the stage's own precondition (the auction refuses once slots
exist; the draft refuses once 120 picks exist). `DRAFT_SEED` is additionally verified
against the published `seed_commit_hash` — a mismatch aborts rather than warns.

The draft dry run assigns **provisional seed-ordered slots in memory** when the auction
has not run, so the pick DATA block, the context ceiling and the label-leak check are all
exercised against real 2026 data *before* the irreversible step, not after it.

### 2. Three remaining cron routes

Five of eight now exist. **The other three 404 every time they fire.**

| Route | Model calls | State | Notes |
|---|---|---|---|
| `score-provisional` | none | ✅ *(4 Aug)* | shares one code path with `score-final` |
| `score-final` | none | ✅ *(4 Aug)* | writes the stat-correction diff (SPEC §5.5) |
| `waiver-resolve` | none | ✅ *(4 Aug)* | deterministic FAAB resolution |
| `weekend-guide` | 33 | ✅ *(5 Aug)* | resumable; ran end to end on production |
| `lineups` | 8 | ❌ | **highest consequence — a missed lineup scores 0** |
| `waiver-bids` | 8 | ❌ | unblocked now: `job_runs` shipped |
| `wrap` | 1 | ❌ | beat writer, non-competing model |

> **`lineups` and `waiver-bids` must claim a `job_runs` row before their first model
> call, and must NOT pass `resumable`.** A re-called model can name different players,
> which collide with nothing and spend the budget twice. Only `weekend-guide` is
> resumable, because its unit of spend is individually idempotent.

> **Watch the 300s ceiling.** `weekend-guide` was shipped with 33 sequential calls and
> could never have completed in production. Any job making more than a handful of model
> calls needs them parallel, persisted incrementally, or both.

The three deterministic routes share one code path (`src/lib/scoring/week.ts`) rather
than two copies that could drift into a provisional table and a final table disagreeing
for reasons nobody can explain. The standings accumulation is extracted as a pure
function and tested (7 tests) — including that a corrected week 3 propagates into every
later cumulative total, which an incremental standings table would get wrong.

Both scoring jobs derive their own week from the ingested schedule
(`resolveScoringWeek`), because cron paths cannot carry a query string and date
arithmetic breaks on exactly the weeks that matter — international games, Thanksgiving,
and the 1 November DST shift.

### 3. `waiver_bids` idempotency constraint

**Blocks `waiver-bids` shipping safely.** Verified: the table has no unique constraint.

Vercel cron delivery is best effort and can fire twice. `lineups` is protected by
`unique (team_id, week)`; `waiver_bids` is not, so a duplicate delivery would spend FAAB
twice and there is no way to un-spend it.

- [x] Migration adding a unique key — `0003_waiver_idempotency.sql` *(4 Aug, applied)*
- [x] Helper built, tested and proven in production — `src/lib/cron/job-run.ts`, 13 tests
- [ ] Wire it into `waiver-bids` when that route is built *(no longer blocked)*

**The unique key alone does not deliver the property this item wants**, which is why the
migration has two layers. One decision produces N claims and `claims: []` (standing pat)
is valid and writes zero rows — so "no rows for this team this week" cannot distinguish
*never ran* from *ran and stood pat*, and a re-delivered call may name **different**
players that collide with nothing. Layer 1 is `unique (team_id, week, add_player_id)` for
integrity; layer 2 is a `job_runs` ledger claimed **before** the first model call, which
is the part that actually stops a second charge.

### 4. End-to-end weekly rehearsal

Run the full Tuesday→Thursday cycle against 2025 data before the real draft. This is the
last cheap chance to find an engine bug.

- [ ] Full weekly cycle dry run on the rehearsal season

> **Sequencing call worth respecting: do not run the real draft until the weekly cycle
> has been rehearsed end to end.** If the lineup or scoring path has a bug, you want to
> find it while rosters are still changeable.

---

## 🟡 Before Week 1 (9 September)

- [ ] **Apply migration `0005_guide_sections.sql`** — the weekend guide's per-game
      takeaways do not persist without it. The site degrades rather than breaking
      (guides fall back to the old single-blob rendering), so this is not urgent, but
      the "Say this" line does not appear until it lands.
- [ ] **Guard `weekend-guide` against running weeks early.** `nextUnplayedWeek` returns
      Week 1 all through August, so in the preseason it writes an article headlined
      "this weekend" about games five weeks out, on projections that will have moved by
      then. Refuse unless kickoff is within a few days.
- [ ] **Homepage still reads "the season has not started"** — needs standings and results
- [ ] **Weekly results pages** — also the real organic SEO opportunity, since they are
      recurring genuinely-new indexable pages
- [x] **Verify `CRON_SECRET` in Vercel** *(5 Aug)* — it was set as `CCRON_SECRET`, a
      typo, so every cron had been failing 500 in production since first deploy. New
      secret set on Production, typo removed, redeployed, verified 401 unauthenticated
      and a successful authenticated run. **Preview environment has no `CRON_SECRET`** —
      the CLI (51.3.0) could not add one; harmless, since cron only fires on production.
- [ ] **Verify the kickoff guard** against the real 2026 schedule, especially the
      **1 November DST shift mid-Week 9** that moves every fixed-UTC cron an hour
      against kickoff
- [ ] **Estimate season model spend and top up OpenRouter.** Measure one real draft call
      first rather than extrapolating from the debate runs — league prompts carry far
      more context (the dossier cap alone is 150k tokens)

---

## 🟢 Content and polish

- [x] **Findings 004: unanimous and unconvinced** *(4 Aug)* — eight models previewed the
      6 Aug CAR @ ARI preseason game from memory with no DATA block. Unanimous pick,
      confidences 0.50–0.53, and not one invented a roster. $0.0997.
      `content/posts/unanimous-and-unconvinced.md`, evidence in `content/data/`.
- [ ] **Findings 005: the five bugs the rehearsal caught.** *(was 004 — renumbered, the
      preview post shipped first.)* Already researched; the strongest unused writing on
      the project and it costs nothing to produce. The backtest page states the headline
      without the story underneath it.
- [ ] **Case-insensitive redirects.** `/faq` works, `/FAQ` 404s — Next routes are
      case-sensitive. Same for `/Findings`, `/Terms` etc.
- [ ] **Submit the sitemap in Search Console.** Submit the path `sitemap.xml`, against a
      **www or Domain property** — a bare-apex property reports zero URLs because the
      apex 308s and every URL in the file is a www URL.
- [ ] **Update `CLAUDE.md`'s build status table.** It claims Phase 4 is "not started" and
      the OpenRouter adapter is "code complete, never called". Both are wrong now — and
      it now also predates the weekend guide, `job_runs` and four new routes.
- [ ] **Add the Sleeper preseason gotcha to `CLAUDE.md`.** `/schedule/nfl/pre/{season}`
      is missing the opening week and its week numbers are shifted by one: Sleeper's
      `pre` week N is the real week N+1. Verified 5 Aug. Harmless today because nothing
      reads preseason data; a trap the first time something does.
- [ ] **`npm audit` advisories** — pre-existing. `--force` would move `next` off the
      pinned 16.2.1, so decide deliberately rather than as a side effect.

---

## Suggested order for the week of 10 August

| Day | Work |
|---|---|
| **Mon** | `lineups` route — highest consequence left, and a missed lineup scores 0. Claim `job_runs`, no `resumable`. |
| **Tue** | `waiver-bids` route. Unblocked now that `job_runs` exists. |
| **Wed** | `wrap` route, then the end-to-end weekly rehearsal on 2025 data. |
| **Thu** | Fix what the rehearsal finds. Findings 005 if there is room. |
| **Fri** | **Run the real auction and draft**, once the weekly cycle has been rehearsed. |

> **Sequencing that still holds: do not run the real draft until the weekly cycle has
> been rehearsed end to end.** Every bug found on 4–5 August was found by running the
> thing, not by reading it — the `CCRON_SECRET` typo, the 300s ceiling, and the seven
> unfiltered projection queries were all invisible until something actually executed.
