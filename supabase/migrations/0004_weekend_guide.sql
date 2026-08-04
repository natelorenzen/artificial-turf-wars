-- The Thursday weekend guide.
--
-- Eight models each give a take on the week's four most interesting games; the
-- non-competing beat writer assembles those takes into one published article.
--
-- Why these live in Postgres and not in content/posts/ like the findings essays:
-- findings are hand-written, argued, and belong in git where their revision history
-- is public. This is generated weekly by a cron job, and a cron job cannot commit to
-- a repository. It follows the `recaps` precedent — generated content is DB-backed
-- and rendered by a dynamic page; written content is markdown in git.
--
-- These are NOT league decisions. They do not touch a roster, a lineup or a budget,
-- so they stay out of `decisions`, which is the season's audit log and should contain
-- exactly the calls that decided the season.

create table game_takes (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id) on delete cascade,
  week          integer not null,
  -- 'CAR@ARI' — away@home, matching nfl_games.
  game_key      text not null,
  model_id      uuid references models(id) on delete set null,

  -- The bounded take. Deliberately two audiences in two fields rather than one blob:
  -- the novice line has to stand alone at a bar, the expert line has to survive
  -- someone who already knows the number being cited.
  novice_point  text,
  expert_point  text,
  player_to_watch text,
  -- Not a score prediction. We hold no team-level data, so a winner call would be
  -- unfounded — see the note in src/lib/preview/games.ts.
  swing_factor  text,
  confidence    numeric(4,3),

  cited_fields    text[],
  unsupported_claims text[],
  raw_response  text,
  valid         boolean not null default true,
  context_hash  text,
  cost_usd      numeric(10,6),
  created_at    timestamptz not null default now(),

  -- One take per model per game per week. Makes the job idempotent on retry.
  unique (season_id, week, game_key, model_id)
);

create index on game_takes (season_id, week);

create table weekend_guides (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons(id) on delete cascade,
  week           integer not null,
  headline       text not null,
  standfirst     text not null,
  column_md      text not null,
  -- The games covered, in the order the article discusses them.
  game_keys      text[] not null,
  -- Everything the writer was given, so the article is checkable against its inputs.
  facts_packet      jsonb not null,
  facts_packet_hash text not null,
  model_calls    integer not null default 0,
  cost_usd       numeric(10,6) not null default 0,
  published      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (season_id, week)
);

comment on column weekend_guides.published is
  'False until a human releases it. A cron job writes the draft; it does not publish on its own.';

alter table game_takes enable row level security;
create policy game_takes_public_read on game_takes
  for select to anon, authenticated using (true);

alter table weekend_guides enable row level security;
create policy weekend_guides_public_read on weekend_guides
  for select to anon, authenticated using (true);
