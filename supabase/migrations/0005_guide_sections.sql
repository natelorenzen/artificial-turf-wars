-- Give every game in the weekend guide a takeaway a layman can repeat.
--
-- The first version had the beat writer return one blob of markdown. The novice line
-- — half the point of the format — ended up buried mid-paragraph, where nobody can
-- grab it and say it to someone else.
--
-- `sections` stores the writer's structured output: one row per game, each with a
-- standalone `takeaway` and the fuller `body_md`. A required schema field is
-- enforceable; "please start each section with a one-liner" is a formatting request a
-- model can quietly ignore.
--
-- `column_md` stays, and stays NOT NULL, but is now DERIVED from `sections` rather
-- than written independently — so the prose and the takeaways cannot disagree about
-- what the article says. It remains the fallback for any guide written before this.

alter table weekend_guides
  add column if not exists sections jsonb;

comment on column weekend_guides.sections is
  'Per-game [{game_key, takeaway, body_md}]. The takeaway is one repeatable sentence for a reader with no football knowledge. Null on guides written before 0005.';
comment on column weekend_guides.column_md is
  'Derived from sections. Kept so older guides still render and so the article has one canonical markdown form.';
