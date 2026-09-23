-- Weekly NFL picks: every model picks the winner of every game, with a probability.
--
-- For entertainment. There are no betting lines, no odds and no sportsbook anywhere in
-- this data — a pick is "who wins, and how sure", graded all season on accuracy and on
-- calibration (Brier score), against two dumb baselines: a coin flip and "always pick
-- the home team".
--
-- Like `game_takes`, these are NOT league decisions. A pick moves no roster and spends
-- no budget, so it stays out of `decisions`, the audit log of calls that decided the
-- fantasy season. It is published just as completely: prompt, raw response, and the
-- hash of the DATA block every model was given.
--
-- Nothing here stores a GRADE. The outcome of a game is computed at read time from
-- each DEF unit's `pts_allow` in `player_stats` (the opponent's score), so a stat
-- correction regrades the pick instead of leaving a stale verdict behind.

create table pick_sets (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references seasons(id) on delete cascade,
  week            integer not null,
  model_id        uuid not null references models(id),

  prompt_version  text not null,
  system_prompt   text not null,
  user_prompt     text not null,
  -- Identical for all eight models in a week, by construction: nobody sees anyone
  -- else's picks. Publishing it is what makes that checkable.
  context_hash    text not null,

  raw_response    text,
  headline        text,
  valid           boolean not null default false,
  validation_error text,
  provider_failure boolean not null default false,
  retry_count     integer not null default 0,
  latency_ms      integer,
  cost_usd        numeric(10,6),
  locked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- One set per model per week. Makes the job resumable: a re-run calls only the
  -- models that have no row yet.
  unique (season_id, week, model_id)
);

create table game_picks (
  id           uuid primary key default gen_random_uuid(),
  pick_set_id  uuid not null references pick_sets(id) on delete cascade,
  season_id    uuid not null references seasons(id) on delete cascade,
  week         integer not null,
  model_id     uuid not null references models(id),
  -- 'CHI@CAR' — away@home, matching game_takes and nfl_games.
  game_key     text not null,
  -- The NFL team the model says wins. Always one of the two in game_key.
  pick         text not null,
  -- Probability the PICKED team wins, 0.5 to 1.
  win_prob     numeric(4,3) not null check (win_prob >= 0.5 and win_prob <= 1),
  reason       text,
  created_at   timestamptz not null default now(),
  unique (season_id, week, model_id, game_key)
);

create index on game_picks (season_id, week);

alter table pick_sets enable row level security;
create policy pick_sets_public_read on pick_sets
  for select to anon, authenticated using (true);

alter table game_picks enable row level security;
create policy game_picks_public_read on game_picks
  for select to anon, authenticated using (true);
