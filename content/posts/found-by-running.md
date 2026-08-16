---
title: "Eighteen bugs in nineteen days. Not one was found by reading the code."
summary: "The league is built: eight cron jobs, a draft runner, a playoff bracket, 393 tests. Getting here surfaced eighteen bugs, four of which would have ended the season outright and two more of which would have corrupted the one-shot draft. Every one was invisible until something executed — and the worst were all in code that had been read, reviewed, and tested. Two of the eighteen were found on the day this post went up, hours after it argued they would be."
date: 2026-08-16
kicker: Findings 008
evidence: "Every bug below is in the commit history with the fix and the test that pins it. The two rehearsed seasons are in the public decision log — `scripts/weekly-rehearsal.ts`, `scripts/playoff-rehearsal.ts` — with every prompt and every raw response."
---

Eight frontier models are about to draft a fantasy football team each. The machine that
will run their season is finished: eight cron jobs, a guarded draft runner, a playoff
bracket, a beat writer, 393 tests across 29 files. It has never played a down.

Nineteen days of building produced eighteen bugs. This post is about where they were
found, because the distribution is lopsided enough to be worth reporting on its own.

> **Updated the evening it was published.** This post went up saying sixteen. Two more
> were found hours later, in the course of asking a question the post should have
> prompted sooner — and both are the strongest evidence for the argument below. They are
> the last section.

**None of them were found by reading the code.** Not in review, not in a type error, not
in a test written in advance. Every single one surfaced when something ran — and the four
that would have ended the season were all sitting in code that had already been read,
reviewed, and covered by passing tests.

## Where eighteen bugs came from

| What was running | Bugs | Date |
|---|---|---|
| The first real cron job in production | 4 | 4–5 Aug |
| Two rehearsed weekly cycles against 2025 | 8 | 6 Aug |
| Writing a post about the draft board | 1 | 10 Aug |
| A rehearsed postseason against 2025 | 3 | 14 Aug |
| Asking what the models actually see when they draft | 2 | 16 Aug |

The rehearsals cost $2.83 in model calls. The draft rehearsal cost $4.99. Call it eight
dollars to find eighteen bugs, four of which were season-ending and two more of which
would have corrupted a draft that only happens once.

## The four that would have ended it

**A one-character typo in an environment variable.** `CRON_SECRET` was set in production
as `CCRON_SECRET`. So `process.env.CRON_SECRET` was `undefined`, the auth check threw, and
**every cron job had been returning 500 before doing any work since the first deploy** —
including the daily data ingest. Silently, for weeks. Nothing was watching the one signal
that would have shown it, because there was nothing yet to watch for.

**A schedule feed with no kickoff time in it.** Sleeper's schedule returns
`{"status":"pre_game","date":"2026-09-13","home":"CAR","week":1,…}` — a date and nothing
else. We stored `new Date(g.date)`, which JavaScript reads as UTC midnight, i.e. 8pm ET
*the evening before the games*. Every guard asking "are we still before kickoff?" was
measuring against an instant 17 to 24 hours too early. The consequence, traced against the
real 2026 schedule: **the lineup job would have refused to run every week from week 2
onward**, throwing "kickoff was 16.0h ago" every Thursday, and no lineup would ever have
been set by a model. It was invisible precisely because it failed *early* — a guard with
too much slack reads as a healthy guard.

**A draft board that was seven-eighths the same player.** `player_projections` has
`unique (player_id, season, week)`. That constrains nothing for season-long rows, because
their `week` is NULL and in SQL every NULL is distinct from every other NULL. The daily
ingest had been inserting a fresh copy of every player, every day, since the moment the
`CRON_SECRET` fix started letting it run. Jonathan Taylor had seven identical rows.

The draft reads the top 1000 rows by projection. Those 1000 rows held **145 distinct
players, each repeated seven times.** Eight models would have drafted from a board of 145
believing it held 1000, and because drafted players are removed by id, the six surviving
copies of anyone taken would have stayed on the board for somebody else to draft again.

This project already knew that rule. An earlier migration splits a table into two partial
indexes carrying exactly this comment: *"NULLs do not collide under a plain unique."* The
lesson was written down and never carried back to the table the draft reads.

**A migration that broke the job it was protecting.** The fix for the above replaced the
useless plain constraint with two partial indexes. Correct — but a partial index cannot be
an `ON CONFLICT` target through PostgREST, and only the season-long write had been
converted away from upsert. The weekly write was left behind, so **applying the fix broke
the daily ingest at the moment it was applied.** That job feeds the projections behind
every lineup decision of the season. It was caught within the hour only because a
rehearsal happened to need week-15 projections and could not get them.

## Three bugs that were the same bug

The most useful pattern came out of the weekly rehearsals, and it was not about the models
being wrong.

- **Grok 4.5** had its entire waiver claim set rejected for a duplicate drop — filing
  several contingent claims that each dropped the same player, which is normal in leagues
  supporting conditional claims. Ours resolves claims independently. The rule was enforced
  from day one and **stated nowhere in the prompt.**
- **Qwen3.7 Plus** sent `"null"` for its defense slot, explaining it was *"leaving the DEF
  slot empty due to the Vikings being on bye."* Rejected: "null is not on this roster."
- **GPT-5.6 Sol** sent JSON `null` for two slots after losing the waiver bids that would
  have filled them. Rejected by the schema.

Three models penalised for accurately describing a situation our schema or our prompt gave
them no way to describe. The rules *require* an unfilled slot to be shown as empty rather
than as a quiet zero, and the engine had supported empty slots from the start — there was
simply no way for a model to say so. All three would have been published as reasoning
failures under a named lab.

A fourth bug was quietly flattering them in the other direction: the audit trail set its
`fallback` flag from schema validity alone, so every rejection at the engine layer never
reached the public record. Two rehearsal decisions were displayed as having decided
cleanly while their answers were being thrown away.

## Two honest exceptions

The claim at the top needs one qualification, and it makes the point sharper rather than
weaker.

The duplicated draft board was not found by a rehearsal. It was found while **writing a
post about the draft board** — an hour into looking at something else entirely, with the
data in front of us because the prose needed a number in it. The audit-trail bug was found
by a deliberate sweep for the pattern above, once three instances of it had shown up.

So: not every bug was found by running something. But not one was found by reading the
code looking for bugs. They were found by execution, or by having to explain execution to
somebody else. Writing the post was the closest thing to a code review that worked.

## What the rehearsals actually cost

| Decision type | Calls | Schema-invalid | Replaced by code | Spend |
|---|---|---|---|---|
| Draft picks | 120 | 0 | 0 | $4.52 |
| Auction bids | 8 | 0 | 0 | $0.47 |
| Waiver claims | 20 | 0 | 2 | $1.82 |
| Lineups | 24 | 1 | 2 | $1.00 |
| Rules comprehension | 16 | 0 | 0 | $0.30 |
| **Total** | **188** | **1** | **4** | **$8.11** |

188 decisions from eight models. One malformed response. Four answers rejected by the
engine — and as of the sweep above, three of those four turned out to be our fault, not
the model's.

## The two found after this was published

The post went up in the morning. By the evening the count was wrong, and the way it went
wrong is worth more than the original sixteen.

**The briefing was never being sent.** Every model is supposed to get one shared data
pack before the draft — projections, ADP, byes, depth charts, injuries, and the
positional scarcity curves. It was built. It was hashed. It was published on our own
preseason page under the words *"sent byte-identically to all eight."*

It was sent to nobody. The function that builds it had exactly one caller: the script
that stores it in the database. Nothing ever read it back into a prompt.

The sharpest part is that we had already diagnosed the consequence. Our backtest page
says the 2025 rehearsal draft took quarterbacks with five of the first eight picks, in a
league that starts one, and concludes: *"the fix is not a better model. It is the dossier
we had not built yet."* It had been built. It was not connected. The real draft would
have reproduced the exact failure that page blames, with the fix sitting in the database
the whole time.

Nobody found this by reading `draft.ts`. It was found by someone asking what information
the models actually have when they pick.

**A season total that was counted twice.** Wiring the briefing in meant rebuilding it,
and the rebuild put a number in front of us: Josh Allen's 2025 season, 626.6 points.

Quarterbacks do not score 626 points. The true figure was 374.6.

Our scoring publishes provisional numbers on Tuesday and final ones on Thursday, and
never overwrites the first with the second — the whole point is that corrections are
visible. So a corrected week leaves two rows behind, and the briefing was adding both.
Eleven of Allen's seventeen weeks had been re-scored. Christian McCaffrey came out at
697.4 against a real 416.6.

Worse than the inflation is its unevenness: it depends on how many of a player's weeks
happened to get corrected, so it distorted the comparisons *between* players rather than
just the scale. A model reasoning carefully from those numbers would have reasoned its
way somewhere wrong.

And it was self-inflicted. That number was correct on 29 July. **The rehearsals created
it** — the practice runs meant to de-risk the draft wrote the second set of rows, and the
fix meant to inform the draft would have delivered the damage.

It was caught because a dry run printed one player in full. Every count in that dry run
was already correct: 48 of 51 players scouted, six scarcity curves, the right hash. The
sample was added to check the *shape* of the data, and the wrong number happened to be
sitting inside it. A count can be right while the value is nonsense.

## What is left

The draft, on 24 August. That is the whole list.

Everything else is either built and rehearsed, or is waiting on real football: a week
cannot run unattended until there are rosters, and the post queue has nothing to announce
until there are results. The machine's remaining unknowns are all on the other side of an
event that happens once.

Which is the uncomfortable part of a nineteen-day bug list where nothing was caught by
reading. The draft is **120 model calls, one shot, irreversible**, and it is the last
major component that has never run against data that counts. It has been rehearsed
against 2025 — 120 picks, four locks between an invocation and a write, a seed verified
against a published commitment. On the evidence above, that rehearsal is worth
considerably more than the review was.

The date moved for a reason that only exists because of the two bugs above. Now that the
briefing actually reaches the models and carries preseason data, *when* we draft changes
what they know: only one preseason week had been played when this was written, and the
week where starters actually play falls on 20–22 August. So the draft waits until the
24th, and the briefing gets rebuilt that morning — because it is a stored snapshot, and
between 29 July and 16 August, 23 of the 119 players inside the top 120 by ADP changed
injury status.

Which is its own small argument for running things. Two of these bugs were found in a
single afternoon, by wiring up a component and looking at what came out. Neither would
have been found by reading the file that contained them.
