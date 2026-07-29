-- Separate formatting deviations from fabrication.
--
-- `unsupported_claims` was carrying both "this bullet is 25 words" and "this bullet
-- cites a number that appears nowhere" — a public claim that a model made something
-- up, on the basis that it was wordy. Those are different findings with different
-- consequences and they need different columns.

alter table decisions add column if not exists soft_violations text[];

comment on column decisions.unsupported_claims is
  'Claims not backed by the DATA block or the rulebook. A genuine DATA RULE violation.';
comment on column decisions.soft_violations is
  'Cosmetic deviations from the bounded reasoning schema — bullet count, bullet length. Never triggers a fallback.';
