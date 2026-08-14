-- The playoff field, frozen at the moment it is decided.
--
-- Everything else about the bracket is derived on read: who won a semifinal comes from
-- `lineup_scores`, who plays whom comes from `h2h_schedule`. The SEEDING cannot work
-- that way, and the reason is the stat-correction diff this project publishes every
-- Thursday (SPEC §5.5).
--
-- The sequence after week 14 is fixed by the calendar and cannot be reordered:
--
--   Tue  provisional scores for week 14
--   Tue  the playoff pool is released and the four survivors bid on it
--   Wed  bids resolve, rosters change
--   Thu  FINAL week-14 scores, including any stat corrections
--   Thu  week-15 lineups lock, week 15 kicks off that night
--
-- The field therefore has to be decided from Tuesday's provisional numbers — a team
-- cannot be told on Thursday that the roster it rebuilt on Wednesday was for a playoff
-- run it is not in. So the field is FROZEN when the pool runs, and a Thursday
-- correction to week 14 does not re-seed it.
--
-- That is a real commissioner ruling and it needs a real record, not an inference.
-- Re-deriving seeds from the standings on every read would mean a correction silently
-- reordering a bracket that had already been played — and seed order decides an exact
-- tie in a playoff game, so it is load-bearing right up to the final whistle.

create table playoff_seeds (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references seasons(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,

  -- 1 through 4. Seed 1 plays seed 4, seed 2 plays seed 3, and in a tie the lower
  -- number advances.
  seed       integer not null check (seed >= 1),

  -- The standings figures this seeding was taken from, copied rather than joined, so
  -- the published bracket can always answer "on what basis?" even after a correction
  -- has moved the numbers underneath it.
  h2h_record text not null,
  cum_pts    numeric(8,2) not null,
  -- Which scoring pass the field was decided from. Always 'provisional' in practice.
  decided_from text not null default 'provisional',

  created_at timestamptz not null default now(),

  unique (season_id, seed),
  unique (season_id, team_id)
);

comment on table playoff_seeds is
  'The four qualifiers and their seeds, frozen when the playoff pool is released. Never updated: a stat correction after this point changes the published week-14 numbers but not who is in the bracket.';

alter table playoff_seeds enable row level security;
create policy playoff_seeds_public_read on playoff_seeds
  for select to anon, authenticated using (true);
