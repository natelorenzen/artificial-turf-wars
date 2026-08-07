# What's left before the season runs

**Written 1 August 2026, updated 6 August.** Draft is late August (~3 weeks out). NFL
Week 1 kicks off **9 September 2026** (~5 weeks out).

State as verified against the database and the repo on 6 August, not from memory
(`npx tsx --env-file=.env.local scripts/weekly-dry-run.ts --status` reprints all of it):

- 2026 season: **8 teams seeded, rules check passed 8/8, and nothing else.** 0 auction
  bids, 0 draft picks, 0 rosters, 0 lineups. **The draft has not been run.**
  Schedule, byes and week-1 projections are all ingested and healthy (273 games,
  32 byes, 3,236 week-1 projections).
- 2025 rehearsal: draft complete — 120 picks, 128 decisions, $4.99 spent, three gates
  met. **No weekly cycle has ever run against it**: 0 lineups, 0 standings, 0 bids.
  It also holds no schedule, no byes and no weekly projections, which is a blocker —
  see the rehearsal section below.
- Site: live, four findings posts, the weekend guide, FAQ, feed, llms.txt, sitemap.
- `vercel.json` declares **8 cron schedules**; **all 8 routes now exist** (was 5).

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

## What shipped on 6 August

**The three missing cron routes, and the shared machinery underneath them.** No model
calls made, no money spent — everything below was verified read-only against live data.

- **`lineups`, `waiver-bids` and `wrap` routes.** All eight schedules in `vercel.json`
  now resolve to a route. Nothing 404s on a fire any more.
- **`src/lib/weekly/context.ts`** — one loader for the picture both weekly model jobs
  need: rosters with projections, form, injury and bye; opponent; lookahead; standings;
  memory blocks. Built once because two copies of it would drift, and a Thursday lineup
  reasoning from a different league state than Tuesday's waivers is the kind of bug
  nobody finds until somebody replays a week.
- **The §14.6 split-context proof is now enforced on every weekly call.** Base identical
  across all eight, every overlay replaying from `(base, teamId)`, asserted **before**
  the first model call rather than after — a week that has already been paid for eight
  times is a week nobody throws away.
- **The lead-time guard** (`src/lib/cron/upcoming.ts`). Now used by `lineups` and
  `weekend-guide`.
- **`scripts/weekly-dry-run.ts`** — the whole weekly cycle up to the point money is
  spent, then it prints what it built.
- **Migration `0006_recap_publishing.sql`** — `recaps.published`, defaulting false.
  **Not yet applied.**

### Decisions inside that work worth remembering

- **The lineup job writes eight legal lineups BEFORE it calls anybody.** Every team
  without a row for the week gets the deterministic best-projection lineup, flagged
  `carried_forward`; each model answer then overwrites its own seeded row. So the worst
  case of a function killed at the 300s ceiling is a week decided by code and marked as
  such, instead of a week of zeros. A missed lineup is the one failure in this project
  with no recovery at all, and the insurance costs one insert.
- **The waiver fallback is to do nothing.** There is no deterministic "best claim" that
  would be honest to attribute to a model, and inventing a transaction would spend its
  money on our judgement. A rejected claim set is dropped whole, never partially applied.
- **"Stood pat" and "we threw its answer away" are both zero rows in `waiver_bids`** and
  are reported separately everywhere, because conflating them would publish a model as
  passive when it actually failed.
- **The wrap's number check never repairs anything.** A figure the beat writer invented
  is stored, published beside the draft, and left there — retrying it away would hide
  the behaviour that is the actual product.

### Two things the dry run found

- **`weekend_guides.sections` is already applied.** The 5 August entry below saying
  migration `0005` was outstanding was wrong; the column is present and the "Say this"
  line renders.
- **The 2025 rehearsal season cannot run a weekly cycle as it stands.** It has season
  projections and 13,274 actual stat rows, but no `nfl_games`, no `team_byes` and no
  weekly projections — so byes resolve empty, every projection is null, and the free
  agent pool comes back with zero players. `scripts/ingest.ts` grew a
  `--week-projections --week N --season 2025` stage to fix this; `--schedule --season
  2025` covers the rest.

### The live rehearsal — 2025 week 5, run 6 August. $1.04.

**Ran end to end.** 17 model calls in true cron order: waivers → resolution → lineups →
scoring → wrap. Three bugs found, all three fixed, all three now pinned by tests
against the real artefacts rather than invented ones.

What worked, and is worth not breaking:

- **8/8 valid lineups, zero fallbacks.** Confidence spread 0.62–0.90.
- **The waiver-before-lineup ordering earned itself immediately.** Two teams' only
  defence was on bye in week 5. Both fixed it at the waiver step and said so —
  `+ARI $1` "replacing the bye-week Pittsburgh defense", `+SEA $6` "Filled my bye-week
  DEF hole". Rehearsing lineups first would have scored both an empty DEF slot and
  reported it as correct.
- **Two models stood pat citing FAAB preservation**, unprompted — "preserving FAAB for
  future weeks", "for the remainder of the season". That is the cross-week budgeting
  §14 exists to produce, and it does not exist under all-play.
- **Contested bidding resolved on price.** 17 claims, 7 won, $92 spent; four models
  chased the same running back at $20/$17/$14/$11.
- **A 59.6-point week is real, not a bug.** Muse Spark 1.1's optimal was 76.26 — Kittle
  0, Jameson Williams 2, Ravens DEF −2, with two more starters stranded on byes.

#### Bug 1 — the number check was unusable, and would have libelled the writer weekly

Ten flags on the first real article. **Every one was wrong**, for three reasons, none of
them the beat writer's fault:

- **Model version numbers.** "Grok 4.5", "Muse Spark 1.1", "GPT-5.6 Sol" produced `4.5`,
  `1.1` and — because the regex ate the hyphen — `-5.6`. Writer rule 2 *requires* those
  names.
- **Accurate quotation.** The packet carries each model's `closest_call` verbatim, and
  those sentences contain figures. `collectDataIndex` only indexed numbers that appeared
  as JSON numbers, so quoting a model correctly, which rule 4 *instructs*, was scored as
  invention. That accounted for six of the ten.
- **A percentage.** An efficiency of `1.0` written as "100%".

Fixed: index numbers found inside the packet's string values, strip model display names
before scanning, and allow the ×100 form of any value in [0,1]. **0 false positives, and
it still catches a real one** — the surviving flag, `1.19`, is a projection gap the
writer derived from data the wrap packet does not contain at all.

> Worth stating plainly, because it nearly shipped: a false positive here is far more
> expensive than a missed one. This check publishes an accusation against a named lab.

#### Bug 2 — the check passed an article that got the result backwards

The wrap said DeepSeek V4 Pro "fell to GPT-5.6 Sol, 139.14 to 122.92". **DeepSeek won
with that 139.14.** Both figures were straight out of the packet, so the number check
waved it through — only the relationship between them was false, and the headline and
social post were both built on it.

Added `resultCheck`: a deterministic pass over sentences naming exactly two models,
matching directional verbs between them against the known result. Conservative on
purpose — it judges only pairs that actually played, so "beat everyone except Kimi K3"
is skipped rather than guessed at. It under-reports by construction, which is the right
direction for something that names a lab.

#### Bug 3 — a model was rejected for breaking a rule it was never told

Grok 4.5's whole claim set was rejected for `duplicate drop`. Its headline describes one
sensible swap, so it almost certainly filed contingencies — several claims all dropping
the same tight end, which is normal in a league that supports conditional claims. Ours
resolves every claim independently, so that would drop one player twice.

The rule was enforced in `validateWaiverClaims` from the start and stated nowhere in the
prompt. Publishing that as a reasoning failure would have measured our prompt, not the
model. `WAIVER_TASK` now says it explicitly.

#### Bug 4 — the worst one, and it had nothing to do with the models

Found by building the cron-slack report the "verify the kickoff guard" item asked for.

**Sleeper's schedule feed carries no kickoff time.** Every one of the 273 records for
2026 is `{"status":"pre_game","date":"2026-09-13","home":"CAR","week":1,…}` — a date and
nothing else. Confirmed on both hosts, plus `/v1/state/nfl` and the projections feed.

The ingest did `new Date(g.date).toISOString()`, which JavaScript reads as UTC midnight —
**8pm ET the evening before the games**. So `kickoff_at` was 17 to 24 hours earlier than
any real kickoff, and every guard asking "are we before kickoff?" was measuring against
the wrong instant. The consequences, traced against the real 2026 schedule:

- **`lineups` would have refused every week from 2 onward.** Most weeks open Thursday
  night; the stored kickoff for those was Thursday 00:00 UTC, which is 16 hours *before*
  the Thursday 16:00 UTC cron. `assertBeforeKickoff` would have thrown "kickoff was 16.0h
  ago" every single Thursday, and no lineup would ever have been set by a model.
- **`score-final` would have finalised weeks in progress**, because `resolveScoringWeek`
  asks which weeks have started and midnight-UTC-on-game-day always says "this one has".
- It was invisible precisely because it failed *early*, and a guard with too much slack
  reads as healthy.

Fixed in `src/lib/sleeper/kickoff.ts`: model the **earliest** kickoff the league
schedules on that weekday — Sunday 09:30 ET for the London games, Thursday 20:15,
Thanksgiving 12:30, Christmas 13:00 — and store that. Earliest, not typical, because a
deadline has to be the earliest thing it could be racing. DST comes from the platform tz
database rather than a hand-rolled rule; 11 tests, including that the offset flips on
1 November 2026 mid-Week 9.

#### Bug 5 — two weeks of 2026 do not open on a Thursday

Visible only once bug 4 was fixed. **Weeks 1 and 12 open on a Wednesday evening**, so for
those the Thursday cron is not late by an hour, it is late by a day: the last Thursday
firing before a Wednesday kickoff is the Thursday of the week *before*. Both weeks would
have had lineups set six days early, on projections with no injury report attached.

`lineups` and `weekend-guide` now each have a Wednesday **and** a Thursday cron entry, and
stand down on the earlier one whenever the later still clears kickoff by the full margin
(`defersToLaterFiring`, measured from the latest moment Hobby could start it). Normal
weeks are still decided Thursday with that morning's injury news; Wednesday-opener weeks
are decided Wednesday.

`scripts/weekly-dry-run.ts --crons` prints the whole season's margins. Every week now
clears, the tightest being **week 1's weekend guide at exactly 4.0h**.

One thing worth recording because SPEC §5.5 frames it the other way: **the 1 November DST
shift makes forward-looking jobs safer, not tighter.** Kickoffs move an hour later in UTC
while the crons stay fixed, so weeks 9–14 have *more* slack than weeks 2–8 (8.3h vs 7.3h
for lineups). The DST hazard is real for jobs that must FOLLOW an event, not precede one.

### The second rehearsal — 2025 week 6, $0.99

Run to confirm the five fixes. It confirmed them and found two more things.

**The wrap checks now behave.** `resultCheck` silent, number check down to one flag from
ten. Re-running both checks over the stored articles afterwards: **week 6 passes clean at
zero notes, week 5 keeps both of its genuine findings.** That second half is the point —
the leniencies added for week 6 did not launder week 5's inverted result or its invented
`1.19`.

**Bug 6 — the number check's third false-positive class: rounding.** The one surviving
flag was `0.85`, from *"Grok 4.5 and Claude Opus 5 both topped 0.85 efficiency"*. Grok is
0.8532 and Opus 0.9202; both do top 0.85. The writer stated something true, less
precisely. Every packet value is now also allowed at coarser precision. A figure nothing
rounds to is still caught.

**Bug 7 — a model was marked failed for correctly reporting an empty slot.** Houston and
Minnesota on bye left three of eight teams unable to field nine, and the deterministic
fallback left those slots empty too. Two models noticed:

- **Qwen3.7 Plus** sent the string `"null"` for `def` — *"leaving the DEF slot empty due
  to the Vikings being on bye"*. It failed roster validation with "null is not on this
  roster".
- **GPT-5.6 Sol** sent JSON `null` for `te` and `k`, having lost both waiver bids to fix
  exactly those slots. Zod rejected it.

`lineupSchema` required a non-empty string for all nine slots, while the engine has
supported empty ones from the start — `Lineup` fields are `string | null`, `scoreLineup`
emits `empty: true`, and §4.4 *requires* an unfilled slot to be shown as empty rather than
as a quiet zero. There was no way for a model to report the thing the rules anticipate.

Slots are nullable now, both spellings normalise, and `avoidableEmptySlots` keeps the
other half honest: an empty slot is legal only when no startable eligible player is left
un-started. "I had nobody" passes; "I left FLEX empty with four on the bench" is still
rejected, because that is the most gradeable mistake in the game.

> Three of the seven bugs found across both rehearsals — Grok's duplicate drop, Qwen's
> empty DEF, GPT's null slots — are the same bug wearing different clothes: **a model
> penalised for a situation our schema or prompt gave it no way to express.** Every one
> would have been published as a reasoning failure. Worth checking for deliberately
> before the draft rather than discovering three more in September.

#### What the week-6 run showed that week 5 did not

- **Adversarial play.** Kimi K3: *"a capped $13 on Rachaad White as a flex upgrade that
  doubles as a block on Team D."* It won the player; Claude Opus 5 bid $9 and lost him.
  First time opponent awareness produced denial rather than just better self-assessment.
- **Punting.** Qwen3.7 Plus stood pat *"to preserve FAAB for future winnable weeks, as I
  am a heavy underdog against Team G this week."*
- **The rolling-list tiebreak fired on real bids** for the first time — GPT-5.6 Sol lost
  a $1 claim to Muse Spark on waiver priority. That path had only unit tests.
- **The luck detector produced real copy**: Kimi K3 beat 5 of 7 rivals on all-play and
  still lost; GPT-5.6 Sol won with a score that would have lost to 6 of 7.

### The schema sweep — bug 8, and the one place it did not bite

Done deliberately after both rehearsals, because three of the seven bugs so far were the
same shape and finding the rest was free.

**Bug 8 — the audit trail under-reported fallbacks, in the models' favour.**
`runDecision` sets `fallback_applied` from schema validity alone, so every rejection at
the ENGINE layer — `validateWaiverClaims`, `lineupProblem`, an unavailable draft pick —
never reached the decision row. And `fallback_applied` is exactly the flag the site
renders as the public `fallback` tag on team pages and the backtest board.

Two rehearsal decisions were stored `valid: true, fallback_applied: false` with their
answers discarded: **Grok 4.5's rejected waiver claims and Qwen3.7 Plus's rejected week-6
lineup.** Both were publicly shown as having decided cleanly. Only GPT-5.6 Sol's showed
correctly, and only because its rejection happened at the zod layer.

`recordEngineRejection` now annotates the row from all three call sites. `valid` is left
alone on purpose — it means the model returned well-formed, schema-conforming JSON, which
stays true. "Answered properly and was still unusable" is a more interesting failure than
"returned garbage", and collapsing them throws away the distinction the validation policy
rests on. Both historical rows were corrected in place.

**Where it did NOT bite, checked rather than assumed.** The draft path has the same
structure, and `/backtest/draft` publishes a fallback count from it. Audited all 120 picks
of the 2025 rehearsal against the `pick` each model actually named: **every one matches,
zero hidden fallbacks. The published number is honest.** But it was true by luck rather
than by guard, which is not a property worth carrying into a one-shot 120-call draft, so
`runPick` now records its rejections too.

#### Also fixed, found on the way in

`/backtest` counted every roster row with no filter, so the first waiver run against 2025
would have silently moved published draft numbers — and a dropped player keeps its row
with `active = false` rather than disappearing, so the `active` flag would not have saved
it. Now filtered to `acquired_via = 'draft'`. It was a no-op the day it was added, which
is exactly why it was worth adding.

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

### 2. Cron routes — ~~three remaining~~ **all eight exist** *(6 Aug)*

| Route | Model calls | State | Notes |
|---|---|---|---|
| `score-provisional` | none | ✅ *(4 Aug)* | shares one code path with `score-final` |
| `score-final` | none | ✅ *(4 Aug)* | writes the stat-correction diff (SPEC §5.5) |
| `waiver-resolve` | none | ✅ *(4 Aug)* | deterministic FAAB resolution |
| `weekend-guide` | 33 | ✅ *(5 Aug)* | resumable; ran end to end on production |
| `lineups` | 8 | ✅ *(6 Aug)* | seeds fallbacks first, then 8 parallel calls |
| `waiver-bids` | 8 | ✅ *(6 Aug)* | 8 parallel calls, all-or-nothing validation |
| `wrap` | 1 | ✅ *(6 Aug)* | beat writer, deterministic number check |

**None of the three new ones has been fired against a real week.** They typecheck,
build, pass 34 new tests, and their whole read path is exercised by the dry run — but
every bug worth having found on this project was found by running something.

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

### 3. ~~`waiver_bids` idempotency constraint~~ **done** *(6 Aug)*

Vercel cron delivery is best effort and can fire twice. `lineups` is protected by
`unique (team_id, week)`; `waiver_bids` was not, so a duplicate delivery would spend FAAB
twice and there is no way to un-spend it.

- [x] Migration adding a unique key — `0003_waiver_idempotency.sql` *(4 Aug, applied)*
- [x] Helper built, tested and proven in production — `src/lib/cron/job-run.ts`, 13 tests
- [x] Wired into `waiver-bids` *(6 Aug)* — claimed before the first call, not resumable

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

- [x] **Read-only dry run** *(6 Aug)* — `scripts/weekly-dry-run.ts --season 2025 --week 5`.
      Every query in the weekly path returns what the code expects, the base block is
      identical for all eight, every overlay replays, no lab name leaks, and the biggest
      prompt is ~6k tokens against a 400k ceiling. Nothing called, nothing written.
- [x] **Backfill the rehearsal season's schedule and weekly projections** *(6 Aug)* — the blocker
      found by that dry run. 2025 has no `nfl_games`, no `team_byes` and no weekly
      projections, so the rehearsal currently sees zero byes, null projections for all
      120 rostered players, and an empty free-agent pool. A model asked to set a lineup
      from that is being asked a different question than the real season will ask.

      ```bash
      npm run ingest -- --schedule --season 2025
      npm run ingest -- --week-projections --week 5 --season 2025
      ```
- [x] **Backfilled** *(6 Aug)* — 273 games, 32 byes, 3,232 week-5 projections.
- [x] **The live cycle** *(6 Aug)* — `scripts/weekly-rehearsal.ts --week 5`, 17 calls,
      $1.04. Three bugs found and fixed; see the rehearsal section above. Note the order
      is waivers → resolution → lineups, **not** lineups first: the Tuesday and Wednesday
      jobs transact into the week the Thursday job then sets a lineup for.
- [x] **Ran week 6 clean** *(6 Aug, $0.99)* — the fixes held and two more bugs fell out.
      Re-checking both stored articles afterwards: week 6 passes at zero notes, week 5
      keeps both of its genuine findings.

> **Sequencing call worth respecting: do not run the real draft until the weekly cycle
> has been rehearsed end to end.** If the lineup or scoring path has a bug, you want to
> find it while rosters are still changeable.

---

## 🟡 Before Week 1 (9 September)

- [x] ~~**Apply migration `0005_guide_sections.sql`**~~ *(already applied — the 5 Aug
      entry was wrong, verified 6 Aug: `weekend_guides.sections` is present)*
- [x] **Apply migration `0006_recap_publishing.sql`** *(6 Aug, applied)* — verified via
      `weekly-dry-run.ts --status`, and the wrap route's exact upsert exercised against
      the real schema.
- [ ] **Apply migration `0007_social_posts.sql`** — the outbound post queue. Nothing
      reads it yet, so this degrades rather than breaking.
- [x] **Guard `weekend-guide` against running weeks early** *(6 Aug)* — and `lineups`
      with it, which has the same trap. `src/lib/cron/upcoming.ts` refuses any
      forward-looking job whose week does not kick off within 7 days, reported as a
      SKIP rather than an error: February-to-September is seven months of having
      nothing to do, and a weekly 4xx trains whoever watches the cron log to ignore it —
      which is how `CCRON_SECRET` went unnoticed for weeks.
- [x] **Homepage standings** *(6 Aug)* — head-to-head ranks, all-play beside it, shown
      once a week has been scored. Verified in a browser against the 2025 rehearsal.
- [x] **Weekly results pages** *(6 Aug)* — `/results` and `/results/[week]`, reading
      through `buildWrapFacts` so a page cannot disagree with the column about the same
      week. The recurring indexable pages the SEO case rested on.
- [x] **Verify `CRON_SECRET` in Vercel** *(5 Aug)* — it was set as `CCRON_SECRET`, a
      typo, so every cron had been failing 500 in production since first deploy. New
      secret set on Production, typo removed, redeployed, verified 401 unauthenticated
      and a successful authenticated run. **Preview environment has no `CRON_SECRET`** —
      the CLI (51.3.0) could not add one; harmless, since cron only fires on production.
- [x] **Verify the kickoff guard against the real 2026 schedule** *(6 Aug)* — and it was
      the most valuable item on this list. Two season-breaking bugs, both invisible until
      the margins were printed: `kickoff_at` had no time in it at all, and two weeks of
      2026 do not open on a Thursday. See bugs 4 and 5 above.
      `scripts/weekly-dry-run.ts --crons` is now the standing check; re-run it whenever a
      season's schedule is first ingested.
- [x] **Season model spend measured** *(6 Aug)*, from 152 real calls rather than
      extrapolated: waiver $0.089/call, auction $0.058, lineup $0.041, draft pick $0.038,
      wrap ~$0.009. **~$1.54/week × 14 = ~$22, plus ~$5 draft, ~$1 playoffs — call it $30.
      Top up OpenRouter to $45** for retries and re-runs. Zero invalid responses in 152.
- [ ] **Top up OpenRouter to $45** — the number above is measured, the top-up is not done.

---

## 🟢 Content and polish

- [x] **Findings 004: unanimous and unconvinced** *(4 Aug)* — eight models previewed the
      6 Aug CAR @ ARI preseason game from memory with no DATA block. Unanimous pick,
      confidences 0.50–0.53, and not one invented a roster. $0.0997.
      `content/posts/unanimous-and-unconvinced.md`, evidence in `content/data/`.
- [ ] **Findings 005: the eight bugs two rehearsals caught.** *(was "five" — the count
      moved on 6 August.)* The strongest unused writing on the project and it costs
      nothing: every artefact is already in the database. The thesis is better than the
      tally — **three of the eight were models punished for limits in our own schema or
      prompt** (Grok's duplicate drop, Qwen's empty DEF, GPT's null slots), and a fourth
      was our audit trail quietly flattering them. A post about grading LLMs that admits
      most of the failures were the harness's is a genuinely uncommon thing to publish.
- [x] **The OG share card (SPEC §12)** *(6 Aug)* — `/results/[week]/opengraph-image`,
      leading with four scorelines rather than the beat writer's headline. A column has
      been wrong before; a fixture list cannot be. Rendered and looked at, which is how
      the fourth fixture was found sitting on top of the domain line.
- [x] **Case-insensitive redirects** *(6 Aug)* — `src/proxy.ts`, Next 16's name for what
      used to be `middleware.ts`. 308 to the lowercase form, which is what the sitemap
      and every canonical tag already advertise. Assets and `_next` excluded.
- [ ] **Submit the sitemap in Search Console.** Submit the path `sitemap.xml`, against a
      **www or Domain property** — a bare-apex property reports zero URLs because the
      apex 308s and every URL in the file is a www URL.
- [x] **Update `CLAUDE.md`'s build status table** *(6 Aug)* — rewritten against the
      database, plus a map of `src/lib/weekly/`. It now points at this file as the live
      version rather than trying to be one.
- [x] **Add the Sleeper preseason gotcha to `CLAUDE.md`** *(6 Aug)*
- [ ] **`npm audit` advisories** — pre-existing. `--force` would move `next` off the
      pinned 16.2.1, so decide deliberately rather than as a side effect.

---

## Suggested order for the week of 10 August

The three routes that filled Mon–Wed of this plan shipped early, on 6 August. What is
left is the running, which is the part that finds things.

| Day | Work |
|---|---|
| **Mon** | Apply `0006`. Backfill the 2025 schedule and week-5 projections. |
| **Tue** | The live weekly rehearsal on 2025 week 5, in cron order. ~17 calls, ~$0.50. |
| **Wed** | Fix what the rehearsal finds. Homepage standings and weekly results pages. |
| **Thu** | Verify the kickoff guard against the real 2026 schedule and the 1 Nov DST shift. Findings 005 if there is room. |
| **Fri** | **Run the real auction and draft**, once the weekly cycle has been rehearsed. |

> **Sequencing that still holds: do not run the real draft until the weekly cycle has
> been rehearsed end to end.** Every bug found on 4–5 August was found by running the
> thing, not by reading it — the `CCRON_SECRET` typo, the 300s ceiling, and the seven
> unfiltered projection queries were all invisible until something actually executed.
