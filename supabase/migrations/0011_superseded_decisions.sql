-- ---------------------------------------------------------------------------
-- 0011 — mark superseded decisions instead of deleting them
-- ---------------------------------------------------------------------------
--
-- Draft day produced seven decision rows that are real model responses to real
-- prompts, and are not part of the league:
--
--   * three auction decisions from a stage an operator accidentally ran twice
--   * four draft-pick decisions from picks that were re-run after a defect in
--     OUR code was fixed (a 300s timeout, an output ceiling with no floor under
--     the answer)
--
-- Deleting them is the one thing this project consistently refuses. They are
-- evidence — the duplicate auction pair is an accidental controlled experiment
-- showing the same model bidding $11 and then $7 on a byte-identical prompt,
-- which is a more interesting datum than either bid alone.
--
-- But they must not be COUNTED. `/team/[model]` sums decisions and cost per
-- model, so three of eight teams were publishing inflated totals, and a reader
-- comparing models would have been reading our operator errors as model
-- behaviour. That is the same double-counting shape as hard rule 3b, in a
-- different table.
--
-- So: a nullable reason. Null means the decision stands. Non-null means it
-- happened, is kept, is publishable, and does not count. The text is shown
-- rather than hidden — a superseded row with its reason attached is a better
-- disclosure than a row that quietly vanished.

alter table decisions
  add column if not exists superseded_reason text;

comment on column decisions.superseded_reason is
  'Non-null when this decision is retained as record but excluded from published '
  'aggregates: a duplicate run, or an attempt re-run after a defect in our own code. '
  'Never used to hide a model failure — a model that genuinely failed keeps its row '
  'counted, because that is the finding.';

-- Aggregates filter on this, so it wants an index alongside the existing ones.
create index if not exists decisions_live_idx
  on decisions (team_id, type)
  where superseded_reason is null;
