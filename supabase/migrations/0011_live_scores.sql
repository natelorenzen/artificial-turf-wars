-- In-progress scores during a slate, deliberately NOT in `player_stats`.
--
-- The obvious implementation is a third `status` beside 'provisional' and 'final'.
-- `player_stats` is `unique (player_id, season, week, status)` and `lineup_scores` is
-- `unique (lineup_id, status)`, so both would accept one without a schema change at
-- all. That is exactly what makes it dangerous.
--
-- THREE separate readers bucket a stat row with the same line:
--
--     const target = row.status === 'final' ? final : provisional;
--
--   - `loadPoints`            (src/lib/scoring/week.ts)  — scores a week
--   - `seasonPointsByPlayer`  (src/lib/scoring/week.ts)  — season totals sent to models
--   - `writeCorrections`      (src/lib/sleeper/ingest.ts) — the published Thursday diff
--
-- Every one of them reads "not final" as "provisional". A 'live' row would therefore be
-- treated as a published provisional score by all three: Tuesday's official numbers
-- would be computed from a half-finished Sunday, season totals would double-count every
-- live week, and Thursday's stat-correction diff — which the site publishes as evidence
-- that we never overwrite a score — would compare final against a third-quarter
-- snapshot. That is CLAUDE.md rule 3b a second time, the bug that had Josh Allen's 2025
-- at 626.6 against a true 374.6 and was one dry run from reaching eight models.
--
-- So live scores get their own table. No existing query touches it, which means no
-- existing query can be wrong about it. The scoring path that decides the season is
-- untouched by this feature.
--
-- WHAT THIS IS, AND WHAT IT IS NOT.
--
-- These numbers are a courtesy to a reader watching on Sunday afternoon. They are
-- overwritten in place on every refresh, they are never the basis of a result, and
-- nothing in the league engine reads them: no standing, no head-to-head record, no
-- waiver budget and no bracket seed is derived from a row in here. The authoritative
-- score of a week is still Tuesday's `provisional` and Thursday's `final`, and the
-- moment a week is officially scored this job stops writing about it.
--
-- Per-player live stats are deliberately NOT persisted anywhere. They are fetched,
-- used to score the eight locked lineups in memory, and discarded. Storing them would
-- recreate the trap above by another route, and there is no question worth answering
-- later that a mid-game box score answers better than the final one.

create table live_scores (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  week         integer not null,

  total_pts    numeric(8,2) not null,
  -- Same shape as `lineup_scores.per_slot` — {slot, playerId, points, empty} — so the
  -- site renders a live slot breakdown with the component it already has.
  per_slot     jsonb not null,

  -- How much of the lineup has a Sleeper stat line yet, which is the honest way to
  -- present a partial total: "41.2 through 4 of 9 starters" is a fact, and "41.2" on
  -- its own reads as a bad week rather than an early one. Presence of a line is the
  -- test, so a starter who has played and scored nothing counts as played.
  starters_played integer not null default 0,
  starters_total  integer not null default 0,

  -- Overwritten in place on every refresh. There is no history here on purpose: a
  -- score that never counted has no audit value, and `unique (team_id, week)` keeps
  -- the table at eight rows a week rather than eight per refresh.
  computed_at  timestamptz not null default now(),

  unique (team_id, week)
);

create index on live_scores (week);

comment on table live_scores is
  'In-progress scores shown while a slate is being played. Never authoritative: no standing, record, FAAB balance or bracket seed is derived from this table, and it stops being written the moment a week is officially scored. See the header of 0011_live_scores.sql for why this is not a third player_stats status.';

alter table live_scores enable row level security;
create policy live_scores_public_read on live_scores
  for select to anon, authenticated using (true);
