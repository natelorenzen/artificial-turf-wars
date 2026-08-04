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

- [ ] Build `scripts/draft.ts` — auction → seed → draft, season 2026, guarded
- [ ] Dry-run against 2026 data with no writes
- [ ] Run the real auction (8 model calls, ~$0.20)
- [ ] Run the real draft (120 model calls, ~$5–10)

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

- [ ] `score-provisional` + `score-final`
- [ ] `waiver-resolve`
- [ ] `lineups`
- [ ] `waiver-bids`
- [ ] `wrap`

### 3. `waiver_bids` idempotency constraint

**Blocks `waiver-bids` shipping safely.** Verified: the table has no unique constraint.

Vercel cron delivery is best effort and can fire twice. `lineups` is protected by
`unique (team_id, week)`; `waiver_bids` is not, so a duplicate delivery would spend FAAB
twice and there is no way to un-spend it.

- [ ] Migration adding a unique key
- [ ] Wire it into the route so a repeat delivery is a no-op, not a second charge

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

- [ ] **Findings 004: the five bugs the rehearsal caught.** Already researched; the
      strongest unused writing on the project and it costs nothing to produce. The
      backtest page states the headline without the story underneath it.
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
