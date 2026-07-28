# Artificial Turf Wars

**Eight AI models. One NFL fantasy season. Watch them think.**

Eight frontier language models each run a fantasy football team for the 2026 season
with no human help. They draft, set a lineup every week, and bid against each other on
waivers. Real NFL results score them. Every prompt and every raw response is published.

**The product is the reasoning, not the trophy.** All eight models receive a
byte-identical block of data, so every difference in what they do is attributable to
the model itself. This repository is built to show that: where they agreed, where one
broke from the field, what each said was its hardest call, and — after the games — who
was right.

## This is an exhibition, not a benchmark

Stated up front because it is the honest framing and it does not change later:

One season shares one set of NFL luck across all eight teams. Fourteen weeks is a small
sample. The draft has real luck in it — an injury in Week 2 to a first-round pick is
nobody's reasoning failure. The cohort is not price-matched; it spans $0.32 to $5.00 per
million input tokens.

**The winner is the best manager of *this* season, not the best possible manager.**
Anyone claiming otherwise is overreading it, and so would we be.

## The cohort

One team per lab, each lab's current top-tier generally-available model, all routed
through OpenRouter.

| Team | Lab | Team | Lab |
|---|---|---|---|
| GPT-5.6 Sol | OpenAI | Muse Spark 1.1 | Meta |
| Claude Opus 5 | Anthropic | DeepSeek V4 Pro | DeepSeek |
| Grok 4.5 | xAI | Kimi K3 | Moonshot |
| Gemini 3.1 Pro | Google | Qwen3.7 Plus | Alibaba |

Model IDs are pinned before the draft and never swapped mid-season, even if a lab ships
something newer in October. A mid-season swap would invalidate the comparison.

**Conflict-of-interest disclosure:** this project was built by Claude, and Claude Opus 5
competes in it. Every scoring decision, ruling, tiebreak, and fallback is deterministic
code — never a model call. The published audit log is what makes that claim checkable
rather than merely asserted.

## How a season runs

**Before the season.** One shared data pack — the full draftable player pool with
projections, ADP, positional scarcity curves, bye weeks, and depth charts — is generated
once, hashed, and sent byte-identically to all eight. No model gets web search: eight
models searching independently would return different results at different times and
destroy both fairness and reproducibility.

Each model then sits a **rules comprehension check** with objectively correct answers
computed from the rulebook. Any model scoring below 100% has the rulebook re-injected
and re-answers, and the failure is published. A model that cannot restate the scoring
table has not been outreasoned — it has been misbriefed, and every later decision it
makes would be uninterpretable.

Each model then publishes a **gameplan**, which is checked against its actual behaviour
all season.

**The draft slot is auctioned, not drawn.** One shared $100 budget funds both the slot
bid and the entire season's waiver claims, so buying the first pick means managing short
all year. Sealed single-round bid plus a full 1–8 slot preference ranking. This is the
most open-ended decision in the project — there is no consensus answer even among expert
humans — and it converts draft position from disclosed luck into an earned advantage.

**Every week.** Each model sets nine starters from fifteen, then submits sealed FAAB
waiver bids. Both come back as structured reasoning: a headline, the data fields that
drove it, the call it was least sure about, what would have changed its mind, and a
self-rated confidence.

**Scoring.** Yahoo's default values, full PPR, computed from raw Sleeper stats by our own
engine. Ranking is **all-play** — each team is compared against all seven others every
week — because that removes both schedule luck and timing luck. A balanced double
round-robin head-to-head record is published alongside it as a co-headline, and where the
two disagree we lead with the disagreement.

## What makes it fair

Fairness here is mechanical, not aspirational:

- One frozen context per week, hashed, sent to all eight. **All eight decisions in a week
  must share one `context_hash`** — that is the machine-checkable proof no model got
  different data.
- Identical system prompt and identical generated rulebook in every call. The rulebook is
  generated from the same config that drives the scoring engine, so it cannot drift from
  the rules it describes.
- No tools, no web search, no function calling, for anyone.
- Identical retry policy and identical deterministic fallbacks — and every fallback is
  publicly flagged as a model error rather than quietly repaired. Provider outages are
  recorded separately, because a model should not be blamed in the standings for its
  provider's downtime.
- Memory parity: a fixed-size, identically-structured continuity block. Unbounded history
  would degrade the smallest context window in the cohort first.
- The `available` player list is ordered deterministically by projection for everyone,
  because models measurably favour items earlier in a list.

**What we deliberately do not equalise:** latent football knowledge, and inference
compute. Models were trained on different corpora and some think longer before answering.
We run each in its default shipped configuration and log reasoning tokens so the
asymmetry is visible and quantified rather than silent.

## Status

The season has not started. NFL Week 1 opens 2026-09-09 and the draft runs late August.

Built and tested: the Sleeper ingest, the scoring engine, the rulebook generator and
prompt assembly, the commissioner engine (auction, snake draft, all-play, head-to-head
schedule, FAAB), the rules comprehension check, the OpenRouter adapter, and the audit
logging path. 103 tests pass.

Not yet built: the 2025 backtest that gates the draft, the live auction and draft runs,
the weekly jobs, and the public site. No model has been called yet — not one API request
has been made to any competitor.

See [`CLAUDE.md`](CLAUDE.md) for the phase-by-phase status and [`SPEC.md`](SPEC.md) for
the full build specification, including the Yahoo alignment matrix documenting every rule
where this league matches Yahoo's defaults and every place it knowingly departs.

## Stack

Next.js 16 (App Router) · TypeScript · Supabase Postgres · Tailwind v4 · zod ·
OpenRouter · Vercel + Vercel Cron · vitest

```bash
npm install
npm test                              # 103 tests, no network or keys required
npm run typecheck
npx tsx scripts/ingest.ts --dry-run   # hits the live Sleeper feed, writes nothing
npm run dev
```

Copy `.env.local.example` to `.env.local` for anything that touches Supabase or
OpenRouter. The site itself is fully public and read-only — there are no user accounts,
and nobody ever logs in.

## Layout

```
src/lib/config/league.ts   the single source of truth: rules, scoring, cohort
src/lib/scoring/           raw Sleeper stats → our points
src/lib/sleeper/           HTTP client and ingest, snapshot + content hash
src/lib/prompt/            rulebook generator, memory block, context hashing
src/lib/engine/            auction, draft, all-play, schedule, FAAB, lineups
src/lib/preseason/         the rules comprehension check
src/lib/openrouter/        one adapter, eight models
supabase/migrations/       schema
tools/                     the simulations that calibrated the auction budget
```

## License

Not yet chosen.
