-- The weekly wrap is a byline piece, and nothing auto-publishes under a byline.
--
-- `weekend_guides` already works this way: the cron job writes a draft, a human
-- releases it. `recaps` shipped without the flag because at the time nothing wrote to
-- it. The wrap job now does, so it needs the same discipline — more so, because the
-- wrap makes factual claims about the standings and the deterministic number check
-- can only flag a bad figure, not fix one.
--
-- Defaulting to false is the whole point. A draft nobody looks at stays unread; an
-- article that publishes itself and misstates a score has already been read.

alter table recaps
  add column if not exists published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists model_calls integer not null default 0,
  add column if not exists cost_usd numeric(10,6) not null default 0;

comment on column recaps.published is
  'False until a human releases it. The cron job writes drafts only.';
comment on column recaps.number_check_passed is
  'Deterministic post-pass: every figure in the article was found in the facts packet. False does not block storage — the failure is the finding, and it is published alongside the draft rather than hidden by a retry.';
