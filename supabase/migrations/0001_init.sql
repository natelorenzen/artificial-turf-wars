-- Gridiron Gauntlet — initial schema (SPEC §5.4)
--
-- The site is fully public read-only: there is no auth, no user accounts, ever.
-- RLS stays ON with an anon SELECT policy so the anon key can never write; every
-- mutation goes through the service-role client in a server-side route.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Cohort and season
-- ---------------------------------------------------------------------------

create table models (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,          -- 'claude-opus-5'
  display_name  text not null,                 -- 'Claude Opus 5'
  openrouter_id text not null,                 -- pinned before the draft, never swapped
  lab           text not null,
  context_window integer not null,
  price_in      numeric(10,4) not null,
  price_out     numeric(10,4),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table seasons (
  id               uuid primary key default gen_random_uuid(),
  year             integer unique not null,
  scoring_config   jsonb not null,             -- frozen copy of src/lib/config/league.ts
  rulebook_version text not null,
  rulebook_text    text,                       -- generated, byte-identical in every call
  budget_total     integer not null default 100,
  draft_seed       text,                       -- revealed only after the auction
  seed_commit_hash text not null,              -- sha256(seed), published beforehand
  seed_revealed_at timestamptz,
  draft_completed_at timestamptz,
  created_at       timestamptz not null default now()
);

create table teams (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references seasons(id) on delete cascade,
  model_id         uuid not null references models(id),
  draft_slot       integer,                    -- 1..8, assigned by the auction
  auction_bid      integer,
  slot_preference  integer[],
  faab_remaining   integer,                    -- budget_total - auction_bid at season start
  waiver_priority  integer,                    -- rolling list, seeded reverse draft order
  frozen           boolean not null default false,   -- model deprecated mid-season (§5.6)
  frozen_reason    text,
  created_at       timestamptz not null default now(),
  unique (season_id, model_id)
);

create index on teams (season_id);

-- ---------------------------------------------------------------------------
-- The audit table (SPEC §7.1). Every model call lands here, valid or not.
-- ---------------------------------------------------------------------------

create type decision_type as enum (
  'rules_check', 'gameplan', 'auction', 'draft_pick', 'lineup', 'waiver', 'recap'
);

create table decisions (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references seasons(id) on delete cascade,
  team_id              uuid references teams(id) on delete cascade,  -- null for the beat writer
  model_id             uuid references models(id),
  type                 decision_type not null,
  week                 integer,
  round                integer,
  pick_overall         integer,

  prompt_version       text not null,
  rulebook_version     text not null,
  dossier_hash         text,
  memory_block         text,
  system_prompt        text not null,
  user_prompt          text not null,
  context_hash         text not null,          -- sha256 of the DATA block

  raw_response         text,                   -- verbatim, pre-parse
  parsed_json          jsonb,
  valid                boolean not null default false,
  validation_error     text,
  fallback_applied     boolean not null default false,  -- public "model error" flag
  provider_failure     boolean not null default false,  -- outage, not the model's fault
  retry_count          integer not null default 0,

  temperature_requested numeric(4,2),
  temperature_honored   numeric(4,2),
  reasoning_tokens     integer,
  latency_ms           integer,
  tokens_in            integer,
  tokens_out           integer,
  cost_usd             numeric(12,6),

  -- structured reasoning, extracted for querying (SPEC §4.1a)
  headline             text,
  key_factors          text[],
  closest_call         text,
  what_would_change_it text,
  confidence           real,
  cited_fields         text[],                 -- DATA fields detected in key_factors
  unsupported_claims   text[],                 -- claims the DATA block does not back

  created_at           timestamptz not null default now()
);

create index on decisions (season_id, type, week);
create index on decisions (team_id, type, week);
create index on decisions (context_hash);

-- ---------------------------------------------------------------------------
-- Pre-season (SPEC §4.1b, §4.2)
-- ---------------------------------------------------------------------------

create table dossiers (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id) on delete cascade,
  content      jsonb not null,
  content_hash text not null,
  token_count  integer not null,
  built_at     timestamptz not null default now()
);

create table rules_checks (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  attempt     integer not null default 1,
  answers     jsonb not null,
  score       integer not null,
  max_score   integer not null,
  passed      boolean not null,
  decision_id uuid references decisions(id),
  created_at  timestamptz not null default now(),
  unique (team_id, attempt)
);

create table gameplans (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references teams(id) on delete cascade unique,
  positional_strategy text not null,
  auction_stance      text not null,
  scarcity_read       text not null,
  risk_posture        text not null,
  waiver_philosophy   text not null,
  decision_id         uuid references decisions(id),
  created_at          timestamptz not null default now()
);

create table auction_bids (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade unique,
  bid             integer not null,
  slot_preference integer[] not null,
  assigned_slot   integer not null,
  tiebroken       boolean not null default false,
  decision_id     uuid references decisions(id),
  created_at      timestamptz not null default now()
);

create table plan_adherence (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  week          integer not null,
  followed_plan boolean,
  note          text,
  created_at    timestamptz not null default now(),
  unique (team_id, week)
);

-- ---------------------------------------------------------------------------
-- Sleeper data. Every pull is snapshotted; decision-time code reads only from here.
-- ---------------------------------------------------------------------------

create table snapshots (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,               -- 'players' | 'projections' | 'stats' | 'schedule' | 'adp'
  season       integer,
  week         integer,
  position     text,
  url          text not null,
  content_hash text not null,
  row_count    integer not null,
  snapshot_at  timestamptz not null default now()
);

create index on snapshots (source, season, week, position, snapshot_at desc);

create table players (
  sleeper_id        text primary key,
  name              text not null,
  position          text not null,           -- QB RB WR TE K DEF
  nfl_team          text,
  active            boolean not null default true,
  depth_chart_order integer,
  injury_status     text,
  years_exp         integer,
  updated_at        timestamptz not null default now()
);

create index on players (position, active);
create index on players (nfl_team);

create table player_projections (
  id            uuid primary key default gen_random_uuid(),
  player_id     text not null references players(sleeper_id) on delete cascade,
  season        integer not null,
  week          integer,                     -- null = season-long
  proj_pts      numeric(8,2),                -- OUR scoring, computed from raw projection fields
  raw_projection jsonb,
  adp           numeric(8,2),                -- from the week-1 endpoint; 1000.0 filtered out
  pos_adp       numeric(8,2),
  snapshot_id   uuid references snapshots(id),
  created_at    timestamptz not null default now(),
  unique (player_id, season, week)
);

create index on player_projections (season, week, proj_pts desc);

create table player_stats (
  id            uuid primary key default gen_random_uuid(),
  player_id     text not null references players(sleeper_id) on delete cascade,
  season        integer not null,
  week          integer not null,
  raw_stats     jsonb not null,
  computed_pts  numeric(8,2) not null,
  status        text not null default 'provisional',  -- 'provisional' | 'final'
  snapshot_id   uuid references snapshots(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (player_id, season, week, status)
);

create index on player_stats (season, week);

-- Stat corrections are published as a diff, never overwritten silently (SPEC §5.5).
create table stat_corrections (
  id           uuid primary key default gen_random_uuid(),
  player_id    text not null references players(sleeper_id) on delete cascade,
  season       integer not null,
  week         integer not null,
  provisional_pts numeric(8,2) not null,
  final_pts    numeric(8,2) not null,
  delta        numeric(8,2) not null,
  detected_at  timestamptz not null default now()
);

create table nfl_games (
  id          uuid primary key default gen_random_uuid(),
  season      integer not null,
  week        integer not null,
  season_type text not null default 'regular',
  home        text not null,
  away        text not null,
  kickoff_at  timestamptz,
  unique (season, season_type, week, home, away)
);

create index on nfl_games (season, week);

-- Derived from nfl_games: any of the 32 teams absent from a week is on bye (SPEC §5.3).
create table team_byes (
  season   integer not null,
  nfl_team text not null,
  week     integer not null,
  primary key (season, nfl_team)
);

-- ---------------------------------------------------------------------------
-- Draft, rosters, lineups
-- ---------------------------------------------------------------------------

create table draft_picks (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id) on delete cascade,
  round         integer not null,
  pick_overall  integer not null,
  team_id       uuid not null references teams(id) on delete cascade,
  player_id     text not null references players(sleeper_id),
  pool_narrowed boolean not null default false,   -- round-13 soft cap fired (SPEC §4.3)
  decision_id   uuid references decisions(id),
  created_at    timestamptz not null default now(),
  unique (season_id, pick_overall)
);

create table rosters (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  player_id     text not null references players(sleeper_id),
  acquired_via  text not null,                  -- 'draft' | 'waiver'
  acquired_week integer,
  faab_paid     integer not null default 0,
  active        boolean not null default true,
  dropped_week  integer,
  created_at    timestamptz not null default now()
);

create index on rosters (team_id, active);
create unique index rosters_one_active_stint on rosters (team_id, player_id) where active;

create table lineups (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  week        integer not null,
  qb          text references players(sleeper_id),
  rb          text[],
  wr          text[],
  te          text references players(sleeper_id),
  flex        text references players(sleeper_id),
  k           text references players(sleeper_id),
  def         text references players(sleeper_id),
  carried_forward boolean not null default false,   -- a job was missed (SPEC §5.6)
  locked_at   timestamptz,
  decision_id uuid references decisions(id),
  created_at  timestamptz not null default now(),
  unique (team_id, week)
);

create table lineup_scores (
  id          uuid primary key default gen_random_uuid(),
  lineup_id   uuid not null references lineups(id) on delete cascade,
  week        integer not null,
  status      text not null default 'provisional',
  total_pts   numeric(8,2) not null,
  per_slot    jsonb not null,                  -- {slot, player_id, pts, empty}
  optimal_pts numeric(8,2) not null,
  efficiency  numeric(6,4) not null,
  created_at  timestamptz not null default now(),
  unique (lineup_id, status)
);

create table waiver_bids (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  week           integer not null,
  add_player_id  text not null references players(sleeper_id),
  drop_player_id text not null references players(sleeper_id),
  bid            integer not null,
  won            boolean not null default false,
  losing_reason  text,                          -- 'outbid' | 'tiebreak' | 'insufficient_budget'
  reasoning      text,
  decision_id    uuid references decisions(id),
  created_at     timestamptz not null default now()
);

create index on waiver_bids (week, add_player_id);

-- ---------------------------------------------------------------------------
-- Standings, evaluation, spectator numbers
-- ---------------------------------------------------------------------------

create table h2h_schedule (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id) on delete cascade,
  week         integer not null,
  home_team_id uuid not null references teams(id) on delete cascade,
  away_team_id uuid not null references teams(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (season_id, week, home_team_id)
);

create table standings (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  week       integer not null,
  -- all-play records are numeric: an exact tie awards half a win (SPEC §6.1)
  allplay_w  numeric(5,1) not null,
  allplay_l  numeric(5,1) not null,
  cum_allplay_w numeric(6,1) not null,
  cum_allplay_l numeric(6,1) not null,
  h2h_w      integer not null default 0,
  h2h_l      integer not null default 0,
  h2h_t      integer not null default 0,
  week_pts   numeric(8,2) not null,
  cum_pts    numeric(9,2) not null,
  k_pts      numeric(8,2) not null default 0,   -- the noisiest slot, reported separately
  faab_remaining integer,
  rank       integer,
  created_at timestamptz not null default now(),
  unique (team_id, week)
);

create table move_evaluations (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references teams(id) on delete cascade,
  week                 integer not null,
  lineup_efficiency    numeric(6,4),
  pts_left_on_bench    numeric(8,2),
  flex_delta           numeric(8,2),
  closest_call_correct boolean,
  waiver_roi           numeric(8,2),
  dollars_per_point    numeric(8,2),
  def_stream_hit       boolean,
  plan_adherence       boolean,
  created_at           timestamptz not null default now(),
  unique (team_id, week)
);

create table win_prob (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  week      integer not null,
  team_a    uuid not null references teams(id) on delete cascade,
  team_b    uuid not null references teams(id) on delete cascade,
  p_a_wins  numeric(6,4) not null,
  mu_a      numeric(8,2), mu_b numeric(8,2),
  sigma_a   numeric(8,2), sigma_b numeric(8,2),
  method    text not null,                     -- 'normal' | 'montecarlo'
  created_at timestamptz not null default now(),
  unique (season_id, week, team_a, team_b)
);

create table allplay_proj (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references teams(id) on delete cascade,
  week                  integer not null,
  expected_allplay_wins numeric(5,2) not null,
  playoff_odds          numeric(6,4),
  title_odds            numeric(6,4),
  created_at            timestamptz not null default now(),
  unique (team_id, week)
);

create table pos_strength (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  week           integer not null,
  slot           text not null,
  starter_pts    numeric(8,2) not null,
  bench_pts_left numeric(8,2) not null,
  league_rank    integer,
  created_at     timestamptz not null default now(),
  unique (team_id, week, slot)
);

create table recaps (
  id                  uuid primary key default gen_random_uuid(),
  season_id           uuid not null references seasons(id) on delete cascade,
  week                integer not null,
  headline            text not null,
  short_post          text not null,
  column_md           text not null,
  facts_packet        jsonb not null,
  facts_packet_hash   text not null,
  number_check_passed boolean not null,
  number_check_notes  text[],
  decision_id         uuid references decisions(id),
  created_at          timestamptz not null default now(),
  unique (season_id, week)
);

-- ---------------------------------------------------------------------------
-- Public read-only access. Writes are service-role only.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'models','seasons','teams','decisions','dossiers','rules_checks','gameplans',
    'auction_bids','plan_adherence','snapshots','players','player_projections',
    'player_stats','stat_corrections','nfl_games','team_byes','draft_picks','rosters',
    'lineups','lineup_scores','waiver_bids','h2h_schedule','standings',
    'move_evaluations','win_prob','allplay_proj','pos_strength','recaps'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t || '_public_read', t);
  end loop;
end $$;
