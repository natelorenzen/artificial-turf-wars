-- Preseason box scores, deliberately NOT in `player_stats`.
--
-- `player_stats` is `unique (player_id, season, week, status)` with `week not null`.
-- Preseason week 1 and regular-season week 1 collide on that key, and a preseason line
-- landing in the regular-season table would be scored as though it counted — silently,
-- because every downstream reader filters by season and week and would have no way to
-- tell the two apart. The two are different questions and they get different tables.
--
-- This holds the SEASON-LONG preseason aggregate only, and that is a deliberate
-- narrowing rather than a shortcut. Sleeper's per-week `pre` endpoint is shifted by one
-- and missing its opening week entirely — its `pre` week N is the real preseason week
-- N+1 (verified 5 Aug 2026, re-verified 16 Aug: `pre` week 1 returns games dated
-- 2026-08-13, which is really the second week of the preseason). The aggregate has no
-- week number in it and therefore cannot inherit that off-by-one.
--
-- WHAT THIS IS FOR, and the reason the columns are what they are.
--
-- Preseason POINTS are close to worthless as a draft signal and actively misleading if
-- presented without context: established starters barely play, so the top of the
-- preseason scoring leaderboard is backups and camp bodies. Checked against the live
-- 2026 data before building this — the top six preseason RBs by PPR were Amar Johnson,
-- Corey Kiner, Dean Connors, Salvon Ahmed, J'Mari Taylor and Kaytron Allen, not one of
-- them a player any of these models should be drafting early.
--
-- What IS signal is ROLE: `off_snaps` against `team_off_snaps` is snap share, which is
-- how a fan actually reads the preseason — who is winning a camp battle, which rookie
-- is on the field with the starters, whether a veteran has played at all. That is why
-- the snap columns are first-class here and the box score stays in `raw_stats`.

create table preseason_stats (
  id             uuid primary key default gen_random_uuid(),
  player_id      text not null references players(sleeper_id) on delete cascade,
  season         integer not null,

  -- Games the player actually appeared in. Sleeper omits `gp` on some lines rather
  -- than returning zero, so this defaults to 0 — never read the raw key directly
  -- (the §5.2 absent-key trap).
  games_played   integer not null default 0,

  -- Offensive snaps, and the team's offensive snaps over the same span. Kept as two
  -- raw counts rather than a stored percentage so the denominator is always visible:
  -- 21 of 66 and 2 of 6 are very different facts about a player and round to the
  -- same share.
  off_snaps      integer not null default 0,
  team_off_snaps integer not null default 0,

  -- The full Sleeper line, so a future question can be answered without a re-fetch.
  raw_stats      jsonb not null,

  snapshot_id    uuid references snapshots(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (player_id, season)
);

create index on preseason_stats (season);

comment on table preseason_stats is
  'Season-long preseason aggregate, used to give drafting models a view of role and health. Never scored — preseason points do not count in this league and the scoring engine never reads this table.';

alter table preseason_stats enable row level security;
create policy preseason_stats_public_read on preseason_stats
  for select to anon, authenticated using (true);
