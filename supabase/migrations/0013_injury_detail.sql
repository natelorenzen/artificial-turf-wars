-- The rest of Sleeper's injury record, which ingest had been throwing away.
--
-- Until week 3 the models saw one word per player: `injury_status`. "Questionable" on a
-- player recovering from meniscus surgery and "Questionable" on a player with a sore
-- back were byte-identical in every DATA block. Week 2 made the cost visible: one model
-- started Brock Bowers (Questionable, knee meniscus surgery, no week-1 score) on his raw
-- projection, citing the tag, with nothing in front of it to say this Questionable
-- was the serious kind. Sleeper's feed had that information the whole time.
--
-- Stored verbatim. We do not grade severity ourselves: a severity score of ours would
-- be a judgement handed to eight models that are meant to be making their own, for the
-- same reason §6.4 keeps our win probability out of every prompt.
--
-- `practice_participation` and `practice_description` are kept although they are
-- almost always null (1 of 2,725 rostered players on 18 Sep 2026). Null there means
-- "the feed did not report it", never "practised fully", and the DATA block says so.

alter table players
  add column injury_body_part       text,
  add column injury_notes           text,
  add column injury_start_date      text,
  add column practice_participation text,
  add column practice_description   text;
