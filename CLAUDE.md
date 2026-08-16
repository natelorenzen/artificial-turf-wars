# Gridiron Gauntlet — project context

Eight frontier LLMs each manage one fantasy football team for the 2026 NFL season.
Real Sleeper results score them. Every prompt and every raw response is published.

**The product is the reasoning, not the trophy.** Read `SPEC.md` before changing
anything — it is the reconciled build spec and it is authoritative. Section numbers
below refer to it.

**⚠️ SPEC §14 (v3, 2026-07-28) supersedes parts of §3.3, §4.3–§4.5, §6.1 and the
§4.1-iii rulebook.** The goal is exposing model reasoning under *bounded chaos*, so:
head-to-head now ranks (all-play is published but does not), models see their
opponent and the draft board, and eliminated rosters are released into a playoff FAAB
pool. Under all-play there was no opponent, and therefore no punting, no
variance-seeking, and no cross-week budgeting — the model just started its highest
projections forever.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router (`16.2.1`) |
| Language | TypeScript |
| DB | Supabase Postgres |
| Styling | Tailwind v4 |
| Icons | lucide-react |
| Validation | zod 3 (strict parse of every model response) |
| Model calls | OpenRouter, one key, all eight |
| Share cards | `@vercel/og` |
| Tests | vitest |
| Hosting | Vercel + Vercel Cron (**Pro required** — 7 cron entries) |

No auth, no user accounts, ever. The site is fully public read-only: RLS is ON with
an anon `SELECT` policy on every table, and all writes go through the service-role
client in server-side routes.

---

## Hard rules

1. **The commissioner is code** (§8.4). Scoring, validation, rulings, tiebreaks, and
   fallbacks are deterministic TypeScript. Never a model call. This project was built
   by Claude and Claude Opus 5 competes in it — determinism is what makes the
   conflict-of-interest disclosure checkable.
2. **`src/lib/config/league.ts` is the single source of truth.** The League Rulebook
   sent to every model is *generated* from it (`src/lib/prompt/rulebook.ts`), so the
   rulebook can never drift from the engine. Changing a scoring number means bumping
   `RULEBOOK_VERSION` and disclosing it on `/methodology`.
3. **Never read Sleeper's `pts_ppr`.** Our interception value differs. Compute from
   raw stat fields via `src/lib/scoring/engine.ts`.
4. **Every stat read defaults to 0.** Sleeper omits keys instead of returning zero;
   `stats.safe * 2` on a defense with no safety yields `NaN` and silently poisons a
   score. Use `n(stats, key)` — never index raw stats directly.
5. **Sequential + delay for every Sleeper call.** No `Promise.all()` fan-out.
6. **Decision-time code reads only from our own snapshots**, never a live third-party
   fetch, so every past decision replays exactly.
7. **Never overwrite a published score.** Tuesday writes `provisional`, Thursday
   writes `final`, and the diff is published (§5.5).
8. **Model IDs are pinned** in `league.ts` before the draft and never swapped
   mid-season, even if a lab ships something newer in October.
9. **No lab or model name may ever reach a DATA block** (§14.3). Rivals appear only as
   stable anonymous labels derived from draft slot (`src/lib/engine/labels.ts`).
   Without this the season stops measuring fantasy reasoning and starts measuring how
   these models treat each other's brands. Guard prompts with `assertNoLabelLeak`.
10. **Models never see our win probability** (§6.4). They get the opponent's roster and
    scoring history — descriptive facts — and form their own view. Handing them our
    estimator would mean they are reasoning from it rather than the shared data, and
    it would destroy the calibration finding.
11. **The context-hash claim is now two-part** (§14.6). Opponent data means the eight
    DATA blocks differ by construction. Assert the *base* block is identical across
    all eight AND that each per-team overlay replays from `(base, teamId)`. The
    methodology page must state this weaker claim, not the old one.

---

## Sleeper API gotchas (verified 2026-07-27)

- **403s on default programmatic User-Agents.** Send a browser-like `User-Agent` on
  every request. `src/lib/sleeper/client.ts` does this.
- **Two hosts.** `api.sleeper.app` for the 14.6 MB player pool and the schedule;
  `api.sleeper.com` for projections and stats. The projections host is undocumented.
- **ADP is not on the season-long projections endpoint** (`adp: null`). Real ADP is
  on the *week-1* endpoint as `adp_dd_ppr`. `1000.0` means "unranked" — filter it.
- **The schedule feed has NO KICKOFF TIME.** Every record is
  `{"status":"pre_game","date":"2026-09-13","home":"CAR","week":1,"game_id":…,"away":"CHI"}`
  — a date and nothing else, on both hosts, and no other endpoint carries one (checked
  `/v1/state/nfl` and the projections feed, 6 Aug 2026). `new Date("2026-09-13")` reads
  that as UTC **midnight**, i.e. 8pm ET the evening *before* the games, which put every
  before-kickoff guard 17–24 hours early and made the lineup job look like it had a week
  of slack when it had none. `src/lib/sleeper/kickoff.ts` models the **earliest** kickoff
  the league schedules on that weekday (Sunday 09:30 ET for the London games, Thursday
  20:15, Thanksgiving 12:30, Christmas 13:00) and the ingest stores that. It is modelled,
  not reported — never present it as a game's actual start time.
- **Not every week opens on Thursday.** In 2026, weeks 1 and 12 open on a **Wednesday**
  evening, so a Thursday-only cron lands a week early for them. `lineups` and
  `weekend-guide` each have a Wednesday *and* a Thursday entry and stand down on the
  earlier one whenever the later still clears kickoff (`defersToLaterFiring`). Check any
  new season with `scripts/weekly-dry-run.ts --crons`.
- **No bye-week field exists.** Derive byes from
  `api.sleeper.app/schedule/nfl/regular/{season}`: any of the 32 teams absent from a
  week is on bye. Validated for 2026 — all 32 teams, exactly one bye each.
- **Kicker bands don't cover sub-20-yard FGs.** Derive 0–39 by subtraction. Never use
  `fgm_50_59` and `fgm_50p` together — `fgm_50p` already includes 50–59.
- **`st_td` vs `def_st_td`.** A special-teams TD is owned by the DEF/ST unit only.
  Scoring both would pay 12 points for one return. There is a test asserting 6.
- **The preseason schedule endpoint is shifted by one and missing its first week.**
  `/schedule/nfl/pre/{season}` omits the opening week entirely, and its `week` numbers
  are off: Sleeper's `pre` week N is the real preseason week N+1. Verified 5 Aug 2026.
  Harmless today because nothing reads preseason data — a trap the first time anything
  does. `regular` is not affected.

---

## Layout

```
src/
  app/                    # App Router pages + /api/cron/* route handlers
  lib/
    config/league.ts      # ← source of truth: rules, scoring, cohort
    scoring/engine.ts     # raw Sleeper stats → our points
    sleeper/              # HTTP client + ingest jobs, snapshot + hash
    prompt/               # rulebook generator, system prompt, memory, hashing
      context.ts          #   ← v3: opponent view, lookahead, standings, draft board
    openrouter/           # one adapter, eight models, retries, fallbacks
    schemas/              # zod schemas, one per decision type
    engine/               # auction, draft, all-play, H2H schedule, FAAB, evaluation
      labels.ts           #   ← v3: anonymous stable rival labels
      playoff-pool.ts     #   ← v3: eliminated-roster release + final FAAB run
  types/
supabase/migrations/      # apply in order via the Supabase SQL editor
scripts/                  # one-shot operator scripts (tsx)
tools/                    # python simulations from the spec phase
design/look-and-feel.html # the 16-bit broadcast mockup (§12)
```

## Commands

```bash
npm run dev       # next dev
npm run build     # next build
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

## Env vars

See `.env.local.example`. Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`,
`OPENROUTER_API_KEY`, `CRON_SECRET`, `DRAFT_SEED`) must never carry a
`NEXT_PUBLIC_` prefix.

## Cron cadence (UTC — Vercel Cron runs on UTC)

| UTC | ET (EDT) | Job |
|---|---|---|
| `0 10 * * *` | 06:00 | Player/projection/schedule ingest |
| `0 14 * * 2` | Tue 10:00 | Provisional scoring, all-play, standings, move evaluation |
| `0 15 * * 2` | Tue 11:00 | Weekly wrap |
| `0 16 * * 2` | Tue 12:00 | Waiver bid calls |
| `0 16 * * 3` | Wed 12:00 | Waiver resolution |
| `0 15 * * 4` | Thu 11:00 | Final re-score, publish stat-correction diff |
| `0 16 * * 4` | Thu 12:00 | Lineup calls for week N+1, then lock |

US DST ends **1 Nov 2026, mid-Week 9**, so every fixed UTC cron shifts an hour
against kickoff. Two defenses, both required: ≥4 hours of slack before the event a
job must precede, and each job asserts the current time is before the week's first
kickoff and refuses to run if not.

**Vercel Hobby is sufficient — SPEC §5.5 is out of date on this** (verified against
the docs 2026-07-28). Hobby allows 100 cron jobs per project, and its once-per-day
frequency cap is satisfied by our one daily + six weekly entries. Hobby's function
`maxDuration` is 300s, which the ingest job sits inside. The one real Hobby cost is
scheduling precision: it fires anywhere within the specified hour (±59 min), which
our ≥4h slack absorbs and the kickoff guard would catch anyway. Upgrade to Pro for
per-minute precision if that margin ever feels thin.

**Cron paths must not carry query strings.** Vercel documents distinguishing two
schedules on one path via the `x-vercel-cron-schedule` header, not via a query
string. Scoring therefore uses two distinct routes, `/api/cron/score-provisional`
and `/api/cron/score-final`.

**Cron delivery is best effort** — Vercel may miss a run or deliver one twice, and
never retries a failure. The ingest job is idempotent (upserts). The model-calling
jobs are NOT: a duplicate invocation would spend eight more model calls. `lineups`
is protected by `unique (team_id, week)`; `waiver_bids` has no such constraint and
will need an idempotency key before that job ships.

## Build status against SPEC §9

Current as of **16 August 2026**, verified against the database. `GO-LIVE.md` defines
*done* as five checkable gates and is re-verified; `TODO.md` is the working log of how
each was closed. When any of the three disagree about status, believe `GO-LIVE.md`.

| Phase | State |
|---|---|
| 0 — scaffold, schema, cron config | **done** — migrations `0001`–`0009` all applied |
| 1 — Sleeper ingest + snapshots | **done** — 2026 holds 273 games, 32 byes, 3,236 season-long projections with no duplication |
| Scoring engine | **done** — incl. the return-TD and absent-key traps |
| Rulebook / prompt assembly | **done** — `rulebook-v3`, split base/overlay hashing |
| 2/3 — OpenRouter adapter | **done and proven** — 188 decisions, 1 malformed response |
| League engine | **done** — auction, snake draft, H2H ranking, all-play, FAAB, lineup/optimal |
| v3 — labels, opponent context, playoff pool | **done** |
| 5 — rules comprehension check | **done** — 19 questions, 8/8 first attempt under v3 *(14 Aug)* |
| Cron guard | **done** — auth, kickoff/DST refusal, lead-time refusal, irreversible lock, `job_runs` ledger. Every week of 2026 clears, **including the playoff weeks** |
| 4 — 2025 backtest | **done** — draft, two weekly cycles and the full postseason rehearsed. 16 bugs found |
| 6 — auction + draft run | 🔴 **not started — the only thing left to build the league.** One irreversible step, four locks, rehearsed on 2025 |
| 7 — weekly jobs | **all 8 routes exist and have run on rehearsal data**; none has fired on a week that counts |
| 8–12 — site, standings, share card | **done** — findings, weekend guide, standings, `/results/[week]` incl. playoff rounds, `/ratings`, OG cards, methodology |
| Playoffs (§14.5, weeks 15–16) | **done and rehearsed** *(14 Aug)* — bracket, pool, champion |
| Social | **built** — X live as @PlayATW; the auto-release path has never had a post to release |

The remaining spec open items are unchanged except: the §4.1b comprehension question
set is now written (`src/lib/preseason/rules-check.ts`).

**What is left is not code.** The draft, then a week of real football. See `GO-LIVE.md`.

### Weekly job layout

```
src/lib/weekly/
  context.ts   # one loader for both model-calling weekly jobs — rosters, opponent,
               #   standings, memory. Split into `weeklyBase` (identical for all
               #   eight) and `weeklyOverlay` (per team, replays from base + teamId)
  lineups.ts   # seeds deterministic lineups BEFORE calling anyone, then 8 in parallel
  waivers.ts   # free-agent pool, all-or-nothing claim validation, sealed bids
  wrap.ts      # deterministic facts packet, beat writer, deterministic number check
src/lib/cron/
  upcoming.ts  # the lead-time guard: refuse a week that does not kick off within 7 days
  job-run.ts   # claim before you spend
```

## Deviations taken during the build

- **§3.2's table lists `st_td` at 6 for individual players, which contradicts the
  same section's resolution** that a special-teams TD belongs to the DEF/ST unit and
  is worth "exactly 6 league-wide". The engine implements the resolution: `st_td` is
  not scored on a player record, `def_st_td` is scored on the DEF unit, and the
  rulebook says so explicitly. Fix the table in SPEC.md to match.
- **Projections need two derivations Sleeper does not supply** (`src/lib/sleeper/normalize.ts`):
  K projections omit `fgm` and every sub-40-yard field goal, and DEF projections omit
  `pts_allow` entirely. Both are reconstructed from the prior completed season and
  labelled. This is projection input only — actual scoring never uses it. Disclose on
  /methodology.
- **Validation is strict on outcomes, lenient on cosmetics.** A fifth `key_factor` or
  a 23-word bullet is recorded as a soft violation and shown publicly rather than
  triggering a fallback, because reporting a model as having failed over formatting
  would misstate what happened. Ids, bids, and slot permutations are strict.
- **K and DEF have no ADP** on the week-1 endpoint (verified: 0 of 157 and 0 of 32),
  so those dossier rows carry `adp: null`. The DATA RULE already covers null.

## Known issues

- `npm audit` reports high-severity advisories from pinned transitive deps
  (`minimatch`/`brace-expansion` under eslint, `sharp` under `@vercel/og`, and `next`
  itself). `npm audit fix --force` would move `next` off the pinned 16.2.1 — decide
  deliberately rather than as a side effect.
