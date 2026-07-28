# Gridiron Gauntlet — project context

Eight frontier LLMs each manage one fantasy football team for the 2026 NFL season.
Real Sleeper results score them. Every prompt and every raw response is published.

**The product is the reasoning, not the trophy.** Read `SPEC.md` before changing
anything — it is the reconciled build spec and it is authoritative. Section numbers
below refer to it.

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

---

## Sleeper API gotchas (verified 2026-07-27)

- **403s on default programmatic User-Agents.** Send a browser-like `User-Agent` on
  every request. `src/lib/sleeper/client.ts` does this.
- **Two hosts.** `api.sleeper.app` for the 14.6 MB player pool and the schedule;
  `api.sleeper.com` for projections and stats. The projections host is undocumented.
- **ADP is not on the season-long projections endpoint** (`adp: null`). Real ADP is
  on the *week-1* endpoint as `adp_dd_ppr`. `1000.0` means "unranked" — filter it.
- **No bye-week field exists.** Derive byes from
  `api.sleeper.app/schedule/nfl/regular/{season}`: any of the 32 teams absent from a
  week is on bye. Validated for 2026 — all 32 teams, exactly one bye each.
- **Kicker bands don't cover sub-20-yard FGs.** Derive 0–39 by subtraction. Never use
  `fgm_50_59` and `fgm_50p` together — `fgm_50p` already includes 50–59.
- **`st_td` vs `def_st_td`.** A special-teams TD is owned by the DEF/ST unit only.
  Scoring both would pay 12 points for one return. There is a test asserting 6.

---

## Layout

```
src/
  app/                    # App Router pages + /api/cron/* route handlers
  lib/
    config/league.ts      # ← source of truth: rules, scoring, cohort
    scoring/engine.ts     # raw Sleeper stats → our points
    sleeper/              # HTTP client + ingest jobs, snapshot + hash
    prompt/               # rulebook generator, system prompt, memory block, hashing
    openrouter/           # one adapter, eight models, retries, fallbacks
    schemas/              # zod schemas, one per decision type
    engine/               # auction, draft, all-play, H2H schedule, FAAB, evaluation
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

| Phase | State |
|---|---|
| 0 — scaffold, schema, cron config | **done** — migration `0001_init.sql` not yet applied to a live project |
| 1 — Sleeper ingest + snapshots | **done** — verified against the live feed (`npx tsx scripts/ingest.ts --dry-run`) |
| Scoring engine | **done** — 14 tests incl. the return-TD and absent-key traps |
| Rulebook / prompt assembly | **done** — generated from config, context hashing, ceiling assertion |
| 2/3 — OpenRouter adapter | **code complete, never called** — needs `OPENROUTER_API_KEY` |
| League engine | **done** — auction, snake draft, all-play, H2H, FAAB, lineup/optimal |
| 5 — rules comprehension check | **done** — 13 questions, deterministic grading |
| Cron guard | **done** — auth, kickoff/DST refusal, irreversible-job lock |
| 4 — 2025 backtest | **not started** — gates the draft |
| 6 — auction + draft run | **not started** — needs Phase 4 first |
| 7–12 — weekly jobs, site, wrap, share card | **not started** |

The remaining spec open items are unchanged except: the §4.1b comprehension question
set is now written (`src/lib/preseason/rules-check.ts`).

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
