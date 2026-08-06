-- The outbound post queue.
--
-- Every post this project makes is composed deterministically from data already in the
-- database, written here as a DRAFT, and released separately. Same discipline as
-- `weekend_guides` and `recaps`, for a stronger reason: a wrong column is a page you can
-- correct, and a wrong post is already in someone's timeline.
--
-- The rule this table exists to make enforceable: a post auto-releases only if the
-- deterministic checks on its source passed. Week 5 of the 2025 rehearsal produced a
-- column asserting DeepSeek V4 Pro "fell to" GPT-5.6 Sol when DeepSeek had won — every
-- figure in the sentence was real and only the relationship was false. `resultCheck`
-- catches that now, and `auto_eligible` is how the queue refuses to broadcast one.

create table social_posts (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id) on delete cascade,

  -- 'results' | 'waivers' | 'weekend' | 'findings' | 'draft'
  kind          text not null,
  week          integer,
  -- Stable idempotency key. One post per kind per week, so a re-run of the composing
  -- job updates the draft instead of queueing a second copy of the same news.
  dedupe_key    text not null,

  body          text not null,
  link          text,

  -- X charges $0.015 for a post and $0.200 for one containing a URL (13x, checked
  -- against docs.x.com on 6 August 2026). Recorded per row so the season's posting cost
  -- is a number anyone can add up here rather than a surprise on a statement.
  est_cost_usd  numeric(8,4) not null default 0,

  -- False when the source failed a deterministic check. Such a post is still composed
  -- and stored — the draft is useful and the failure is worth seeing — it just never
  -- releases without a human.
  auto_eligible boolean not null default false,
  hold_reason   text,

  status        text not null default 'draft',  -- 'draft' | 'posted' | 'skipped' | 'failed'
  posted_at     timestamptz,
  -- The remote id, so a post can be traced back from the timeline to the row that made it.
  remote_id     text,
  error         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index social_posts_dedupe on social_posts (season_id, dedupe_key);
create index on social_posts (status, auto_eligible);

comment on table social_posts is
  'Outbound post queue. Composed deterministically from stored data, written as a draft, released separately.';
comment on column social_posts.auto_eligible is
  'True only when every deterministic check on the source passed. A post derived from a column whose number check or result check failed is held for a human, because a wrong page can be corrected and a wrong post cannot.';
comment on column social_posts.est_cost_usd is
  'X prices a post with a URL at 13x a plain one. Recorded so the season total is checkable.';

alter table social_posts enable row level security;
create policy social_posts_public_read on social_posts
  for select to anon, authenticated using (true);
