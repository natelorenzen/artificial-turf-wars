-- The season-long projection rows had no uniqueness at all, and the daily ingest had
-- been silently duplicating every one of them since the cron started working.
--
-- `unique (player_id, season, week)` looks like it covers this. It does not: `week` is
-- NULL for season-long rows, and in SQL every NULL is distinct from every other NULL, so
-- no two season-long rows ever collide. The daily ingest upserts with
-- `on_conflict=player_id,season,week`, that target never matches an existing row, and
-- Postgres inserts a fresh one. Every day. Forever.
--
-- By 10 August 2026 Jonathan Taylor had seven identical season-long rows, one per ingest
-- since `CRON_SECRET` was fixed on the 5th. 22,637 season-long rows for 2026 where there
-- should have been about 3,200.
--
-- WHAT THIS WOULD HAVE DONE TO THE DRAFT, which was days away when it was found:
-- `loadPool` takes the top 1000 rows by `proj_pts`. Those 1000 rows held 145 distinct
-- players, each repeated seven times. Eight models would have drafted from a board of
-- 145 players believing it held 1000 — and because `availableFor` removes drafted
-- players by id, the six surviving copies of anyone taken would have stayed on the
-- board for somebody else to take again.
--
-- This project already knew the rule. Migration 0003 splits `job_runs` into two partial
-- indexes with exactly this comment: "NULLs do not collide under a plain unique". That
-- lesson was never carried back here.

-- ---------------------------------------------------------------------------
-- 1. Collapse the duplicates, newest wins
-- ---------------------------------------------------------------------------
--
-- Newest rather than oldest because ADP moves through August and the most recent ingest
-- is the one the draft should reason from. The projections themselves have not moved —
-- all seven of Taylor's rows read 272.3 — but the ADP did, 8 to 7 and back.

delete from player_projections p
using player_projections q
where p.week is null
  and q.week is null
  and p.player_id = q.player_id
  and p.season = q.season
  and (p.created_at, p.id) < (q.created_at, q.id);

-- ---------------------------------------------------------------------------
-- 2. Make it impossible again
-- ---------------------------------------------------------------------------
--
-- Two partial indexes, mirroring 0003. The weekly one keeps the behaviour the old
-- constraint actually delivered; the seasonal one adds the half it never did.

alter table player_projections drop constraint if exists player_projections_player_id_season_week_key;

create unique index if not exists player_projections_weekly_key
  on player_projections (player_id, season, week) where week is not null;

create unique index if not exists player_projections_seasonal_key
  on player_projections (player_id, season) where week is null;

comment on index player_projections_seasonal_key is
  'Season-long rows, keyed without `week` because it is NULL for all of them and NULLs never collide. The plain unique that used to sit here let the daily ingest insert a fresh copy of every player every day.';
