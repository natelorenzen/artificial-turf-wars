# Draft day — 24 August 2026

**The one irreversible day in this project.** Everything else can be re-run; this cannot.
Follow it top to bottom. Every step prints something you can check, and nothing writes
until step 5.

Written 16 August 2026, from a session that verified each command against live data. If a
step behaves differently from what is written here, that difference is the finding —
stop and look at it rather than pressing on.

> **Read `CLAUDE.md` first** if you are starting cold. This file assumes the hard rules,
> particularly: the commissioner is code, no lab name may reach a DATA block, and
> decision-time code reads only from our own snapshots.

---

## Before you start

| Thing | Expected |
|---|---|
| Branch | `main`, clean, synced |
| Tests | `npm test` — 400 passing |
| Season | 2026, `rulebook-v3`, 8 teams, **0 auction slots, 0 picks** |
| Schema | 32/32 tables |
| Money | OpenRouter funded; the draft costs ~$5 |

```bash
npm test && npm run typecheck
npx tsx --env-file=.env.local scripts/db-check.ts
npx tsx --env-file=.env.local scripts/draft.ts --status
```

`--status` must say `auction not run` and `draft 0/120 picks`. **If it says anything
else, stop** — either the draft has already started or you are pointed at the wrong
database.

---

## 1. Confirm the cohort you are about to lock

**The freeze date is today.** `COHORT_FROZEN_AT` is `2026-08-24`, so this is the last day
a seat may move; from tomorrow only a provider withdrawing a model justifies a change, and
after the first pick even that is too late. Whatever `COHORT` says this morning is what
plays fourteen weeks of football.

This runs first because a seat that moves creates work downstream — a re-pin has to be
re-gated on the rulebook before it drafts — and because it is free.

```bash
npx tsx --env-file=.env.local scripts/cohort-check.ts
```

Read-only: the OpenRouter catalogue and our own rows, no model calls, no writes. It looks
for the three ways the cohort can be wrong on draft morning:

- **a pinned model is gone or going** — an ID OpenRouter no longer serves fails the draft
  eight calls in; an `expiration_date` inside the season means the withdrawal lands in
  October instead, which is the `teams.frozen` path and strictly worse than moving today
- **a lab shipped something since the last re-pin** (14 August, four seats) — candidates
  are printed with their descriptions, serving variants and same-day siblings filtered out
- **the database disagrees with the config** — the silent failure `scripts/repin-cohort.ts`
  exists to prevent: a re-pin changes a model's *key*, so a plain seed upsert inserts a new
  row, leaves `teams.model_id` on the old one, reports success, and the league quietly
  plays last month's cohort while the site shows this month's

Passing looks like `The eight pinned models are live, current, and correctly seated.`
Anything under **MUST BE RESOLVED BEFORE THE DRAFT** exits non-zero — resolve it. Anything
under **For a human to decide** does not; it is there to be read.

**Keeping all eight is a decision, and it needs no command.** The rule is *top-tier
generally available*, not newest: a cheaper tier of the same generation, an open-weight
sibling, or a specialist is correctly declined, and Google looking eighteen months stale
is that rule working rather than failing. If a seat genuinely should move, it is three
things and not one:

```bash
npx tsx --env-file=.env.local scripts/repin-cohort.ts            # dry run, then --commit
npx tsx --env-file=.env.local scripts/preseason-rules-check.ts   # the new model re-sits it
```

...and then the cohort table on `/methodology` and the `COHORT FREEZE` comment in
`src/lib/config/league.ts` record what moved and why. A model drafting under a rulebook it
has never been gated on is the thing this ordering exists to prevent.

---

## 2. Refresh the data the draft reads

The daily ingest keeps projections and injuries current on its own, but the **preseason
stage is manual on purpose** — it is a preseason-only concept and a daily job returning
nothing from September onward is a failure shape this project has been bitten by twice.

```bash
npm run ingest -- --preseason-stats --season 2026
```

Expect roughly 3,000–3,500 rows across six positions. On 16 August it was 3,300.

Then confirm the daily ingest is actually alive — it is the input to everything, and it
has failed silently before (`CCRON_SECRET`, and again when migration `0008` landed):

```bash
npx tsx --env-file=.env.local scripts/db-check.ts
```

`player_projections` should be in the tens of thousands and `players` around 4,300.

---

## 3. Rebuild the briefing

**This is not optional and the draft will refuse without it.** The dossier is a stored
snapshot; the draft reads whatever is stored. Between 29 July and 16 August, 23 of the
119 players inside ADP 120 changed injury status, and final roster cuts land the week of
the 24th.

```bash
npx tsx --env-file=.env.local scripts/dossier.ts
```

Expect:

```
  players       332
  preseason     332 of 332 carry a preseason line
  injury flags  ~35-45
  tokens        ~34,000 (ceiling 150,000)
  hash          <new hash — note it, it should appear in both dry runs below>
```

**A `WARNING: not one player has a preseason line` means step 2 did not run.** Go back.

By the 24th there should be more preseason coverage than on 16 August, when only the
13 August slate had been played — preseason week 3 falls on 20–22 August and is the week
starters actually appear.

---

## 4. Dry-run both stages

Free, no model calls, no writes. This is the step that has caught something every single
time it has been run.

```bash
npx tsx --env-file=.env.local scripts/draft.ts --auction
npx tsx --env-file=.env.local scripts/draft.ts --draft
```

Check, in the auction output:

- `dossier` — 332 players, **332 with a preseason line**, 6 scarcity curves
- `dossier hash` — matches step 3
- `seed verified against the published commitment`
- **no `WARNING: the stored dossier is N days old`** — if you see it, step 3 did not run

And in the draft output:

- `scouted 48/51 carry a scouting line` (a few outside the scouted set is normal and
  labelled `scouted: false`)
- `label leak none`
- the **sample player printed in full** — read it. Every count in a dry run was correct
  on 16 August while `last_season_points` was nearly double reality, and printing one
  player is what caught it. Sanity-check the numbers: a top QB or RB season is roughly
  **250–420 points**, not 600.

---

## 5. The point of no return

Two stages. **The auction is the irreversible one** — it assigns draft slots, and the
anonymous rival labels `Team A` … `Team H` that every model sees for fourteen weeks are
derived from those slots. Once it commits, that mapping is fixed.

The draft itself is resumable: it writes a row per pick and continues where it stopped.

Four locks stand between an invocation and a write, plus the seed check and the
48-hour dossier freshness guard.

```bash
ALLOW_IRREVERSIBLE=1 npx tsx --env-file=.env.local scripts/draft.ts \
  --auction --commit --i-understand=2026
```

8 model calls. **Budget ~$1.20, not the ~$0.50 this once said** — the estimate predated the
16 August change that sends the auction the whole dossier, which makes each DATA block
~127,000 characters. Actual on 24 August 2026: $1.20.

```bash
ALLOW_IRREVERSIBLE=1 npx tsx --env-file=.env.local scripts/draft.ts \
  --draft --commit --i-understand=2026
```

120 model calls. **Budget ~$9 and a whole afternoon, not the ~$4.50 and 20–40 minutes this
once said.** Actual on 24 August 2026: $8.85 and about five hours, and it was five rather
than two because reasoning-tier models spend real time on a hard board — Qwen3.8 Max
averaged 325 seconds a pick against GPT-5.6 Sol's 23. It prints each pick as it lands.

> **It only runs while the machine is awake.** Everything executes locally; only the model
> calls are remote. A laptop that sleeps stops the draft. Nothing is lost — every pick
> commits its own row — but re-run the same command to continue.

> **If it stops partway, just run the same command again.** It resumes from the last
> committed pick. Do not pass `--picks` to "catch up" — the default is the remainder.

> **`[FALLBACK]` on a pick** means the model's answer was unusable and code chose
> instead. One or two is survivable and is published as such. A run of them means
> something is wrong with the DATA block — stop and look.

---

## 6. Publish the seed

**Between the auction and the first pick, and not after.** The commitment is half a proof;
the reveal is the other half. In 2026 the seed decided a real outcome — three teams bid $0
and it alone put them in slots 4, 7 and 8.

```bash
ALLOW_IRREVERSIBLE=1 npx tsx --env-file=.env.local scripts/draft.ts \
  --reveal-seed --commit --i-understand=2026
```

Revealed after the draft, a seed can always be accused of having been chosen to suit the
picks. Revealed now, the slots are already fixed and it cannot have been shopped for. The
dry run deliberately does not print the seed; only the commit does.

---

## 7. Verify what happened

```bash
npx tsx --env-file=.env.local scripts/draft.ts --status
```

Expect `auction 8/8 slots assigned` and `draft 120/120 picks`. Re-running the draft
command once more is harmless and stamps `seasons.draft_completed_at`, which `/preseason`
reads to report the draft as done.

**Check the fallback count, not just the pick count.** A `[FALLBACK]` means our code chose
and the model did not. In 2026 the first three attempts at a clean board each produced
fallbacks that were *our* fault — a timeout, a parser, and an output budget a model could
spend entirely on thinking. Zero is achievable and is what the board should show.

Then look at the league on the site — `/preseason`, `/teams`, and the draft board. Every
prompt and raw response is public at `/decisions/[id]`; spot-check one pick and confirm
its **dossier hash is attached** rather than null. That field was null on every draft
decision until 16 August, because the briefing was never actually being sent.

---

## 8. The announcement, which is held on purpose

A post is composed for @PlayATW when the draft completes, and it is **deliberately not
auto-released** — unlike every other kind in the queue. It announces a one-shot event, it
is the first thing the account will say unprompted, and the auto-release path has never
run end to end.

**It does not exist until you compose it.** Nothing composes this post automatically —
`social_posts` has no `draft` row until you make one, and the query below returns nothing
before you do. The numbers come from the database rather than from you: picks, fallbacks,
and the spend across the decisions that actually produced the board.

```bash
npx tsx --env-file=.env.local scripts/compose-draft-post.ts            # dry run, prints it
npx tsx --env-file=.env.local scripts/compose-draft-post.ts --commit   # queue it, HELD
```

Then read it:

```sql
select id, body, hold_reason from social_posts where kind = 'draft';
```

To send it, make it eligible; the next daily run (20:00 UTC) picks it up:

```sql
update social_posts set auto_eligible = true where kind = 'draft' and status = 'draft';
```

To not send it, do nothing. It stays a draft row and nothing goes out.

---

## After the draft

Nothing further is required until football starts. The weekly jobs stay silent — the
lead-time guard refuses any week that does not kick off within 7 days — so the only job
doing real work between the draft and **2 September** is the daily ingest.

**Week 1 kicks off Wednesday 9 September, 19:00 ET.** It is one of only two Wednesday
openers in 2026, so the Wednesday `lineups` cron is the one that counts and the Thursday
one must stand down. It also carries the tightest margin of the season — 4.0h for the
weekend guide, exactly the required minimum. Worth watching live rather than reading in
the scores afterwards. See `GO-LIVE.md` Gate 2.

---

## If something goes wrong

| Symptom | What it means |
|---|---|
| `cohort-check: NOT IN THE CATALOGUE` | OpenRouter withdrew a pinned model. The one condition the freeze permits a change for — re-pin, re-gate, disclose |
| `cohort-check: IN COHORT, NO TEAM PLAYS IT` | Config and database disagree. Use `repin-cohort.ts`, never `seed.ts` |
| `REFUSING TO RUN … no dossier has been built` | Step 3 did not run |
| `REFUSING TO RUN … dossier is N days old` | Step 3 did not run today. Rebuild; `--stale-dossier-ok` only if the stale briefing is genuinely what you want |
| `DRAFT_SEED does not match the published commitment` | Wrong `.env` loaded. **Fix the environment; never edit the row** — the commitment is what makes the tiebreak checkable |
| `the 2026 auction has already run` | The auction is done. Move to the draft stage |
| Auction committed, draft failed | Fine. Slots are assigned; re-run the draft command |
| A model call fails | It retries, then falls back deterministically and records the rejection. The draft continues |

**The one thing not to do is re-run the auction.** It refuses once slots exist, and that
refusal is correct — draft slots are the basis of every anonymous label for the season.
