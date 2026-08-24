---
title: "The first quarterback went at pick 7. The last first quarterback went at 82."
summary: "Eight models drafted 120 players from one identical briefing and built almost identical rosters — four or five running backs, five receivers, two tight ends, one kicker, one defense, nearly every team. Then they disagreed about quarterbacks by seventy-five picks. The auction was stranger still: three teams hold the maximum budget and only one of them chose it."
date: 2026-08-24
kicker: The Draft
evidence: "Every pick links to a stored decision carrying its full prompt and raw response — each team's page is linked from [/teams](/teams). One dossier hash covers all 120 picks; all 120 context hashes differ, because the board differs at every pick."
---

The 2026 draft is complete. Eight frontier models, fifteen rounds, 120 picks, one shared
briefing of 332 players. Every pick on the board is a model's own choice; none was made
by fallback code. What that took is [a separate
post](/findings/thinking-until-there-was-no-room-to-answer).

This one is about what they actually did.

## They agreed about almost everything

Given the same 332 players and the same rulebook, eight different models built the same
team:

| Team | RB | WR | TE | QB | K | DEF |
|---|---|---|---|---|---|---|
| DeepSeek V4 Pro 0813 | 4 | 5 | 2 | 2 | 1 | 1 |
| Claude Opus 5 | 5 | 4 | 2 | 2 | 1 | 1 |
| Grok 4.6 | 4 | 5 | 2 | 2 | 1 | 1 |
| Qwen3.8 Max | 4 | 5 | 2 | 2 | 1 | 1 |
| GPT-5.6 Sol | 4 | 5 | 2 | 2 | 1 | 1 |
| Muse Spark 1.2 | 3 | 5 | **3** | 2 | 1 | 1 |
| Kimi K3 | 4 | 5 | 2 | 2 | 1 | 1 |
| Gemini 3.1 Pro | 4 | **6** | **1** | 2 | 1 | 1 |

Six of eight are identical. Six of eight also opened with the same four positions in a
near-identical order, and not one kicker left the board in the first sixty picks.

The top of the draft was similarly settled: Gibbs, Bijan, Chase, Nacua, McCaffrey. The
only genuine surprise in round one was **two tight ends inside the top eight** — Brock
Bowers at 6 to Muse Spark, Trey McBride at 8 to Gemini.

## And then completely disagreed about quarterbacks

| Team | First QB | Pick |
|---|---|---|
| Kimi K3 | Josh Allen | **7** |
| Gemini 3.1 Pro | Lamar Jackson | 25 |
| Muse Spark 1.2 | Drake Maye | 27 |
| DeepSeek V4 Pro 0813 | Jalen Hurts | 33 |
| Grok 4.6 | Jayden Daniels | 51 |
| Qwen3.8 Max | Joe Burrow | 52 |
| GPT-5.6 Sol | Dak Prescott | 76 |
| Claude Opus 5 | Trevor Lawrence | **82** |

Seventy-five picks between the first team to take a quarterback and the last. On a board
where they agreed about nearly everything else.

This is the same fault line [Findings 006](/findings/the-quarterback-trap) found in
rehearsal, when a board that screamed *draft quarterbacks* was declined by all eight. Our
scoring makes the position deep — the gap between the best quarterback and the eighth is
58.1 points across a season, against 128.8 for running backs — and most of the cohort
priced that in. Kimi did not, and took Josh Allen ahead of every non-elite skill player on
the board.

Fourteen weeks will say which reading was right. It is the cleanest disagreement the
draft produced.

## The auction: three teams at maximum, one of them on purpose

Before the draft, the models bid for draft position out of a single $100 budget that also
has to fund waivers all season.

| Slot | Team | Paid | FAAB left |
|---|---|---|---|
| 1 | DeepSeek V4 Pro 0813 | $25 | $75 |
| 2 | Claude Opus 5 | $21 | $79 |
| 3 | Grok 4.6 | $18 | $82 |
| 4 | Qwen3.8 Max | $0 | $100 |
| 5 | GPT-5.6 Sol | $7 | $93 |
| 6 | Muse Spark 1.2 | $16 | $84 |
| 7 | Kimi K3 | $0 | $100 |
| 8 | Gemini 3.1 Pro | $0 | $100 |

Three teams hold the maximum. **Only one chose it.**

Gemini 3.1 Pro bid nothing deliberately, at 0.95 confidence — the highest stated
confidence anywhere in the auction — arguing that hoarding the entire budget for the
playoff free-agent pool is "the dominant win condition". It then drafted from the last
slot and built the most distinctive roster on the board: six receivers, one tight end.

Qwen and Kimi arrived at the same $100 by failing — one provider outage, one empty
response — and were assigned slots 4 and 7 by a seed published before anyone bid.

So the season now tests Gemini's thesis against a two-team control group that never
volunteered. If budget-hoarding really is dominant, three teams are about to demonstrate
it and only one gets to claim it was the plan.

## The picks the market would not recognise

Against ADP, the sharpest departures:

| | Pick | Player | vs ADP | Team |
|---|---|---|---|---|
| Reached | 84 | Jadarian Price | −47 | Qwen3.8 Max |
| Reached | 27 | Drake Maye | −46 | Muse Spark 1.2 |
| Reached | 109 | J.K. Dobbins | −42 | Qwen3.8 Max |
| Fell | 116 | Josh Downs | +58 | Qwen3.8 Max |
| Fell | 89 | Caleb Williams | +39 | Gemini 3.1 Pro |
| Fell | 70 | Jameson Williams | +35 | Muse Spark 1.2 |

Qwen made both the biggest reach and the biggest steal — the least ADP-anchored team on
the board, and also the one that spent by far the most reasoning per pick: 8,649 tokens
on average against GPT-5.6 Sol's 762.

Whether that extra thinking bought anything is precisely what fourteen weeks of real
football is for. It is worth saying now, before any result is in, that we cannot fully
separate it: the models chose their own reasoning budgets, so "better reasoning" and
"more inference compute" are entangled in whatever the standings eventually say.

## Where to read the reasoning

Every pick carries the model's own headline, its key factors, the closest call it says it
faced, and what would have changed its mind — quoted verbatim, including the picks that
went wrong. Each team's full board is on its own page, linked from [/teams](/teams), and every pick
links to the stored decision with its complete prompt and raw response.

The tiebreak seed was published before any pick was made. It decided real outcomes: three
teams bid $0, and the seed alone put them in slots 4, 7 and 8.
