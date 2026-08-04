# What's left before the season runs

**Written 1 August 2026.** Draft is late August (~4 weeks out). NFL Week 1 kicks off
**9 September 2026** (~5.5 weeks out).

State as verified against the database and the repo on 1 August, not from memory:

- 2026 season: **8 teams seeded, rules check passed 8/8, and nothing else.** 0 auction
  bids, 0 draft picks, 0 rosters, 0 lineups.
- 2025 rehearsal: complete. 120 picks, 128 decisions, $4.99 spent, three gates met.
- Site: live, three findings posts, FAQ, feed, llms.txt, structured data, sitemap.
- `vercel.json` declares **7 cron schedules**; exactly **1 route exists**.

`CLAUDE.md`'s build-status table is out of date and contradicts several of the above —
fixing it is on the list below.

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

### 2. Six missing cron routes

`vercel.json` schedules seven jobs. Only `/api/cron/ingest` exists. **The other six 404
every time they fire.**

Split by whether they spend money — the deterministic three can be built *and fully
tested* right now with no budget:

| Route | Model calls | Testable free? | Notes |
|---|---|---|---|
| `score-provisional` | none | ✅ | shares most logic with `score-final` |
| `score-final` | none | ✅ | writes the stat-correction diff (SPEC §5.5) |
| `waiver-resolve` | none | ✅ | deterministic FAAB resolution |
| `lineups` | 8 | ❌ | **highest consequence — a missed lineup scores 0** |
| `waiver-bids` | 8 | ❌ | blocked by item 3 below |
| `wrap` | 1 | ❌ | beat writer, non-competing model |

- [x] `score-provisional` + `score-final` *(4 Aug)*
- [x] `waiver-resolve` *(4 Aug)*
- [ ] `lineups`
- [ ] `waiver-bids`
- [ ] `wrap`

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

- [x] Migration adding a unique key — `0003_waiver_idempotency.sql` *(4 Aug)* **not yet applied**
- [ ] Wire it into the route so a repeat delivery is a no-op, not a second charge
      *(blocked: the route does not exist yet — helper is built and tested,
      `src/lib/cron/job-run.ts`, 10 tests)*

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

- [ ] **Homepage still reads "the season has not started"** — needs standings and results
- [ ] **Weekly results pages** — also the real organic SEO opportunity, since they are
      recurring genuinely-new indexable pages
- [ ] **Verify `CRON_SECRET` in Vercel** and confirm the routes reject unauthenticated
      calls in production, not just in tests
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
      the OpenRouter adapter is "code complete, never called". Both are wrong now.
- [ ] **`npm audit` advisories** — pre-existing. `--force` would move `next` off the
      pinned 16.2.1, so decide deliberately rather than as a side effect.

---

## Suggested order for the week of 3 August

| Day | Work |
|---|---|
| **Mon–Tue** | Draft runner. Build it, dry-run it, **do not fire it yet.** |
| **Wed** | The three deterministic cron routes — no spend, fully testable, a third of the route work. |
| **Thu** | `waiver_bids` migration, then the `lineups` route. |
| **Fri** | End-to-end weekly rehearsal. Findings 004 if there is room. |

That leaves the real draft, `waiver-bids` and `wrap` for the following week — comfortably
ahead of a late-August draft.
