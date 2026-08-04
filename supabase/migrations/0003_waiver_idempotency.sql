-- Make the money-spending weekly jobs safe to deliver twice.
--
-- Vercel cron delivery is best effort: it may miss a run, and it may deliver one
-- twice. `lineups` already survives that on `unique (team_id, week)`. `waiver_bids`
-- had no unique key at all, so a duplicate delivery would call eight models a second
-- time and commit a second set of FAAB claims. FAAB cannot be un-spent.
--
-- Two layers, because neither is sufficient alone.

-- ---------------------------------------------------------------------------
-- Layer 1 — a team cannot bid twice for the same player in the same week
-- ---------------------------------------------------------------------------
--
-- This is a data-integrity constraint, not the idempotency mechanism. It makes an
-- exactly-repeated claim set a no-op on conflict. What it CANNOT do is stop the
-- second delivery from spending money: the duplicate invocation calls the model
-- again, and a model at temperature 0.2 may name different players the second time.
-- Those rows collide with nothing and insert cleanly.
--
-- One decision legitimately produces many claims, so the key includes the player.

alter table waiver_bids
  add constraint waiver_bids_one_bid_per_player
  unique (team_id, week, add_player_id);

-- ---------------------------------------------------------------------------
-- Layer 2 — the actual idempotency key: claim the run before spending anything
-- ---------------------------------------------------------------------------
--
-- Row existence in waiver_bids cannot serve as the guard, because standing pat is a
-- valid and meaningful answer (`claims: []` in the schema) and writes zero rows.
-- "No rows for this team this week" is therefore indistinguishable from "never ran",
-- and a guard that cannot tell those apart will re-run the job every time a model
-- decides to do nothing — which is precisely when it looks like it failed.
--
-- So the run is claimed in its own table BEFORE the first model call. The unique
-- constraint is what makes the claim atomic: two concurrent deliveries both insert,
-- one gets 23505, and that one exits without calling anybody.

create table job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,                   -- 'waiver-bids' | 'lineups' | 'wrap' | ...
  season_id   uuid not null references seasons(id) on delete cascade,
  week        integer,                         -- null for jobs that are not weekly
  status      text not null default 'running', -- 'running' | 'completed' | 'failed'
  detail      text,
  model_calls integer not null default 0,
  cost_usd    numeric(10,6) not null default 0,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- The idempotency key. A partial unique index rather than a table constraint
-- because `week` is nullable and NULLs do not collide under a plain unique --
-- without splitting these two, every non-weekly job could claim itself repeatedly.
create unique index job_runs_weekly_key
  on job_runs (job, season_id, week) where week is not null;
create unique index job_runs_seasonal_key
  on job_runs (job, season_id) where week is null;

create index on job_runs (season_id, week);

comment on table job_runs is
  'Idempotency ledger for cron jobs that spend money. Claimed before the first model call, never after.';
comment on column job_runs.status is
  'A row left in `running` means the job died mid-flight. It still blocks re-delivery: re-running a half-spent job is worse than not running it, and a human should look.';

alter table job_runs enable row level security;
create policy job_runs_public_read on job_runs
  for select to anon, authenticated using (true);
