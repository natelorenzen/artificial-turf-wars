-- The picks bankroll: every model gets $100 of play money for the rest of the season
-- and may bet it on moneylines. Added 25 Sept 2026, from week 3's Sunday games.
--
-- This reverses 0013's "no odds anywhere". Models now see a consensus moneyline for
-- every game in the same prompt they pick in, so their win probabilities are no longer
-- formed blind to the market — disclosed on /methodology, and the reason the market's
-- own de-vigged probability is published beside them as a baseline.
--
-- Play money. Still no sportsbook named or linked anywhere: a price is the median
-- across US books, and the book list lives only in the raw snapshot.
--
-- Numbered 0015, not 0014: PR #52 renumbers the duplicate 0011 and moves game_picks
-- to 0014.

create table odds_snapshots (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  week        integer not null,
  source      text not null,
  fetched_at  timestamptz not null default now(),
  -- The feed exactly as returned, so any consensus price can be recomputed.
  raw         jsonb not null,
  -- The parsed consensus line per game: {game_key: {away, home, books, commence_time}}.
  lines       jsonb not null
);

create index on odds_snapshots (season_id, week, fetched_at desc);

-- The bet rides on the pick row. `bet_team` may be EITHER side: a model can pick the
-- favourite to win and still think the underdog's price is too long.
alter table game_picks
  add column bet_team   text,
  add column stake      integer not null default 0 check (stake >= 0),
  -- American price for bet_team when the bet was placed. Stored on the row, so a bet
  -- settles without reference to any later snapshot.
  add column bet_price  integer,
  -- The consensus line this pick was made against, both sides, for the market baseline.
  add column away_price integer,
  add column home_price integer;

alter table game_picks
  add constraint game_picks_bet_complete
  check (stake = 0 or (bet_team is not null and bet_price is not null));

alter table pick_sets
  -- What the model was told it could stake this week. Recomputable from earlier bets;
  -- stored because it is what the model SAW.
  add column bankroll_available numeric(8,2),
  add column odds_snapshot_id   uuid references odds_snapshots(id);

alter table odds_snapshots enable row level security;
create policy odds_snapshots_public_read on odds_snapshots
  for select to anon, authenticated using (true);
