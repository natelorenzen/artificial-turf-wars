# Sleeper picks, 2026

Eight models, one board of 200 players, asked before the draft which of them
the market has mispriced. Every model saw a byte-identical DATA block.

- Context hash: `5587f5080bed2e7e87a417fe54366220332d3d5fd532413aa92f35642a1eddb8`
- Generated: 2026-08-10T18:34:57.649Z
- Script: `scripts/sleeper-picks.ts`

## Tally

| Player | Pos | ADP | Our proj | Called up by | Called down by |
|---|---|---|---|---|---|
| Ashton Jeanty | RB | 27 | 259.5 | GPT-5.6 Sol, Claude Opus 5, Grok 4.5, Gemini 3.1 Pro, Muse Spark 1.1, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus | — |
| Tee Higgins | WR | 16 | 224.4 | — | GPT-5.6 Sol, Claude Opus 5, Grok 4.5, Gemini 3.1 Pro, Muse Spark 1.1, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus |
| Saquon Barkley | RB | 39 | 246.7 | GPT-5.6 Sol, Claude Opus 5, Grok 4.5, Muse Spark 1.1, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus | — |
| Rashee Rice | WR | 48 | 229.3 | GPT-5.6 Sol, Claude Opus 5, Grok 4.5, Muse Spark 1.1, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus | — |
| De'Von Achane | RB | 9 | 245.4 | — | GPT-5.6 Sol, Claude Opus 5, Grok 4.5, Gemini 3.1 Pro, DeepSeek V4 Pro, Kimi K3, Qwen3.7 Plus |
| Emeka Egbuka | WR | 77 | 224 | GPT-5.6 Sol, Claude Opus 5, Gemini 3.1 Pro, Muse Spark 1.1, Kimi K3, Qwen3.7 Plus | — |
| Jalen Coker | WR | 54 | 165.9 | — | GPT-5.6 Sol, Claude Opus 5, Gemini 3.1 Pro, Muse Spark 1.1, Kimi K3 |
| Jaylen Waddle | WR | 30 | 221 | — | Claude Opus 5, Grok 4.5, Muse Spark 1.1, DeepSeek V4 Pro, Qwen3.7 Plus |
| Caleb Williams | QB | 55 | 299.34 | — | GPT-5.6 Sol, Grok 4.5, DeepSeek V4 Pro, Kimi K3 |
| Drake Maye | QB | 72 | 320.76 | Grok 4.5, DeepSeek V4 Pro, Kimi K3 | — |
| Jameson Williams | WR | 38 | 206.2 | — | GPT-5.6 Sol, Gemini 3.1 Pro, Muse Spark 1.1 |
| Travis Etienne | RB | 78 | 207.7 | GPT-5.6 Sol, Qwen3.7 Plus | — |
| Drake London | WR | 26 | 250.2 | Claude Opus 5, Grok 4.5 | — |
| Parker Washington | WR | 84 | 212.4 | Gemini 3.1 Pro, Muse Spark 1.1 | — |
| Josh Downs | WR | 46 | 180.4 | — | Muse Spark 1.1, Kimi K3 |
| Brian Thomas | WR | 99 | 195.4 | Gemini 3.1 Pro | — |
| Jadarian Price | RB | 131 | 170 | Gemini 3.1 Pro | — |
| Chase Brown | RB | 14 | 255.2 | DeepSeek V4 Pro | — |
| Josh Allen | QB | 29 | 361.5 | — | Claude Opus 5 |
| Jaxson Dart | QB | 56 | 296.54 | — | Grok 4.5 |
| Stefon Diggs | WR | 83 | 163 | — | Gemini 3.1 Pro |
| Brock Bowers | TE | 17 | 253.5 | — | DeepSeek V4 Pro |
| Travis Kelce | TE | 66 | 171.4 | — | Qwen3.7 Plus |
| Calvin Ridley | WR | 166 | 77.3 | — | Qwen3.7 Plus |

## GPT-5.6 Sol

> Attack discounted RB and WR production, and let someone else pay starter-level prices for replaceable quarterbacks.

**Confidence 0.9**

**Undervalued**

- **Ashton Jeanty** — His ADP is 27 (RB12), but our 259.5-point projection ranks him RB6 at a scarce position.
- **Saquon Barkley** — The market prices him at ADP 39 and RB18 even though his 246.7 projected points rank ninth among running backs.
- **Rashee Rice** — His ADP is 48 (WR23), while his 229.3-point projection makes him WR12.
- **Travis Etienne** — He costs ADP 78 as RB26 but projects for 207.7 points and an RB17 finish.
- **Emeka Egbuka** — His ADP is 77 (WR33), yet his 224.0 projected points rank 19th at wide receiver.

**Overvalued**

- **De'Von Achane** — He is drafted ninth overall as RB5 despite a 245.4-point projection that ranks only RB10.
- **Tee Higgins** — His ADP is 16 (WR9), but his 224.4 projected points rank just 18th among wide receivers.
- **Jameson Williams** — The market takes him at ADP 38 as WR17 while his 206.2-point projection ranks WR28.
- **Jalen Coker** — His ADP is 54 (WR27), but his 165.9 projected points place him only 48th at wide receiver.
- **Caleb Williams** — In an eight-team, one-QB league, ADP 55 and QB3 pricing is too aggressive for a 299.34-point projection ranked QB10.

**Positional read.** The market is letting several projected top-20 RBs and WRs fall well beyond their positional ranks. It is also paying too much for the middle quarterback tier in an eight-team league that starts only one QB.

<details><summary>Raw response</summary>

```json
{"undervalued":[{"player_id":"12527","name":"Ashton Jeanty","why":"His ADP is 27 (RB12), but our 259.5-point projection ranks him RB6 at a scarce position."},{"player_id":"4866","name":"Saquon Barkley","why":"The market prices him at ADP 39 and RB18 even though his 246.7 projected points rank ninth among running backs."},{"player_id":"10229","name":"Rashee Rice","why":"His ADP is 48 (WR23), while his 229.3-point projection makes him WR12."},{"player_id":"7543","name":"Travis Etienne","why":"He costs ADP 78 as RB26 but projects for 207.7 points and an RB17 finish."},{"player_id":"12514","name":"Emeka Egbuka","why":"His ADP is 77 (WR33), yet his 224.0 projected points rank 19th at wide receiver."}],"overvalued":[{"player_id":"9226","name":"De'Von Achane","why":"He is drafted ninth overall as RB5 despite a 245.4-point projection that ranks only RB10."},{"player_id":"6801","name":"Tee Higgins","why":"His ADP is 16 (WR9), but his 224.4 projected points rank just 18th among wide receivers."},{"player_id":"8148","name":"Jameson Williams","why":"The market takes him at ADP 38 as WR17 while his 206.2-point projection ranks WR28."},{"player_id":"11646","name":"Jalen Coker","why":"His ADP is 54 (WR27), but his 165.9 projected points place him only 48th at wide receiver."},{"player_id":"11560","name":"Caleb Williams","why":"In an eight-team, one-QB league, ADP 55 and QB3 pricing is too aggressive for a 299.34-point projection ranked QB10."}],"positional_read":"The market is letting several projected top-20 RBs and WRs fall well beyond their positional ranks. It is also paying too much for the middle quarterback tier in an eight-team league that starts only one QB.","headline":"Attack discounted RB and WR production, and let someone else pay starter-level prices for replaceable quarterbacks.","confidence":0.9}
```
</details>

## Claude Opus 5

> In a one-QB, eight-team league, let someone else pay pick 29 for Josh Allen and take Jeanty at 27, Barkley at 39 and Maye at 72 instead.

**Confidence 0.62**

**Undervalued**

- **Ashton Jeanty** — Market has him as RB12 (adp 27) while our projection puts him RB6 at 259.5 proj_pts, essentially matching James Cook (260.8) who goes at adp 10 — that's a full round-plus of surplus at the position that actually needs two-plus starters.
- **Saquon Barkley** — adp_pos_rank 18 (adp 39) versus proj_pos_rank 9 at 246.7 proj_pts, more than Achane's 245.4 and Hampton's 242.9 who both cost 15-30 picks earlier.
- **Rashee Rice** — WR23 by adp (48) but proj_pos_rank 12 at 229.3 proj_pts — more projected points than Tee Higgins (224.4, adp 16) and Zay Flowers (228.2, adp 18) in full PPR.
- **Emeka Egbuka** — adp 77 as WR33 but proj_pos_rank 19 at 224.0 proj_pts; with two WR starters plus a FLEX in an 8-team league, a top-20 WR at pick 77 is the cheapest starter-quality receiving you can buy.
- **Drake London** — proj_pos_rank 8 at 250.2 proj_pts against adp_pos_rank 12 (adp 26) — he outprojects A.J. Brown (247.2) and Justin Jefferson (250.4) who go 12th and 13th.

**Overvalued**

- **Josh Allen** — His 361.5 proj_pts leads all QBs, but in a one-QB, 8-team league Drake Maye is available at adp 72 with 320.76 and Brock Purdy at adp 102 with 303.2, so paying pick 29 buys roughly 40-58 points over a QB you can have three to five rounds later.
- **De'Von Achane** — Drafted RB5 at adp 9 but proj_pos_rank 10 with 245.4 proj_pts — behind Chase Brown (255.2, adp 14), Jeanty (259.5, adp 27) and Barkley (246.7, adp 39).
- **Tee Higgins** — adp 16 as WR9 while proj_pos_rank is 18 at 224.4 proj_pts, below Ladd McConkey (228.2, adp 50) and Malik Nabers (227.3, adp 51).
- **Jaylen Waddle** — adp 30 as WR14 against proj_pos_rank 22 and 221.0 proj_pts — Mike Evans (222.2) and Emeka Egbuka (224.0) project higher at adp 53 and 77.
- **Jalen Coker** — adp 54 (WR27) with proj_pos_rank 48 and only 165.9 proj_pts, a bench-level projection being paid for as a starter.

**Positional read.** The market is paying up for quarterbacks in a format where only eight are started — Allen at adp 29 and Lamar at 49 when Maye (320.76), Purdy (303.2) and Herbert (295.48) sit at adp 72, 102 and 90 — while letting genuinely startable RB/WR volume (Jeanty, Barkley, Rice, Egbuka) slide well past their projections. Tight end is priced about right at the top: Bowers' 253.5 proj_pts is a real edge over TE10 Kittle at 169.3.

<details><summary>Raw response</summary>

```json
{"undervalued":[{"player_id":"12527","name":"Ashton Jeanty","why":"Market has him as RB12 (adp 27) while our projection puts him RB6 at 259.5 proj_pts, essentially matching James Cook (260.8) who goes at adp 10 — that's a full round-plus of surplus at the position that actually needs two-plus starters."},{"player_id":"4866","name":"Saquon Barkley","why":"adp_pos_rank 18 (adp 39) versus proj_pos_rank 9 at 246.7 proj_pts, more than Achane's 245.4 and Hampton's 242.9 who both cost 15-30 picks earlier."},{"player_id":"10229","name":"Rashee Rice","why":"WR23 by adp (48) but proj_pos_rank 12 at 229.3 proj_pts — more projected points than Tee Higgins (224.4, adp 16) and Zay Flowers (228.2, adp 18) in full PPR."},{"player_id":"12514","name":"Emeka Egbuka","why":"adp 77 as WR33 but proj_pos_rank 19 at 224.0 proj_pts; with two WR starters plus a FLEX in an 8-team league, a top-20 WR at pick 77 is the cheapest starter-quality receiving you can buy."},{"player_id":"8112","name":"Drake London","why":"proj_pos_rank 8 at 250.2 proj_pts against adp_pos_rank 12 (adp 26) — he outprojects A.J. Brown (247.2) and Justin Jefferson (250.4) who go 12th and 13th."}],"overvalued":[{"player_id":"4984","name":"Josh Allen","why":"His 361.5 proj_pts leads all QBs, but in a one-QB, 8-team league Drake Maye is available at adp 72 with 320.76 and Brock Purdy at adp 102 with 303.2, so paying pick 29 buys roughly 40-58 points over a QB you can have three to five rounds later."},{"player_id":"9226","name":"De'Von Achane","why":"Drafted RB5 at adp 9 but proj_pos_rank 10 with 245.4 proj_pts — behind Chase Brown (255.2, adp 14), Jeanty (259.5, adp 27) and Barkley (246.7, adp 39)."},{"player_id":"6801","name":"Tee Higgins","why":"adp 16 as WR9 while proj_pos_rank is 18 at 224.4 proj_pts, below Ladd McConkey (228.2, adp 50) and Malik Nabers (227.3, adp 51)."},{"player_id":"7526","name":"Jaylen Waddle","why":"adp 30 as WR14 against proj_pos_rank 22 and 221.0 proj_pts — Mike Evans (222.2) and Emeka Egbuka (224.0) project higher at adp 53 and 77."},{"player_id":"11646","name":"Jalen Coker","why":"adp 54 (WR27) with proj_pos_rank 48 and only 165.9 proj_pts, a bench-level projection being paid for as a starter."}],"positional_read":"The market is paying up for quarterbacks in a format where only eight are started — Allen at adp 29 and Lamar at 49 when Maye (320.76), Purdy (303.2) and Herbert (295.48) sit at adp 72, 102 and 90 — while letting genuinely startable RB/WR volume (Jeanty, Barkley, Rice, Egbuka) slide well past their projections. Tight end is priced about right at the top: Bowers' 253.5 proj_pts is a real edge over TE10 Kittle at 169.3.","headline":"In a one-QB, eight-team league, let someone else pay pick 29 for Josh Allen and take Jeanty at 27, Barkley at 39 and Maye at 72 instead.","confidence":0.62}
```
</details>

## Grok 4.5

> Take Jeanty and Saquon a round after the market, wait on Maye, and skip the mid-QB run.

**Confidence 0.78**

**Undervalued**

- **Ashton Jeanty** — ADP 27 / adp_pos_rank 12 but proj_pts 259.5 slots him as proj_pos_rank 6 at RB, a clear top-tier back the market is treating like a mid RB2.
- **Saquon Barkley** — ADP 39 / adp_pos_rank 18 against proj_pts 246.7 and proj_pos_rank 9, so a near-RB1 projection is available a full round-plus after lesser backs.
- **Drake Maye** — ADP 72 / adp_pos_rank 8 at QB while proj_pts 320.76 is proj_pos_rank 3, elite 1QB production the market is letting slide past worse-projected passers.
- **Rashee Rice** — ADP 48 / adp_pos_rank 23 versus proj_pts 229.3 and proj_pos_rank 12, a WR2 projection buried among WR4/5 prices.
- **Drake London** — ADP 26 / adp_pos_rank 12 with proj_pts 250.2 and proj_pos_rank 8, so the market is missing a top-8 WR projection in the late third round of an 8-team draft.

**Overvalued**

- **De'Von Achane** — ADP 9 / adp_pos_rank 5 but proj_pts only 245.4 and proj_pos_rank 10, paying a top-10 pick for a mid-RB2 projection.
- **Tee Higgins** — ADP 16 / adp_pos_rank 9 against proj_pts 224.4 and proj_pos_rank 18, a late-WR2 price on what we have as a WR3/flex.
- **Caleb Williams** — ADP 55 / adp_pos_rank 3 at QB while proj_pts 299.34 is only proj_pos_rank 10, so the market is drafting a replacement-tier QB as a top-3 signal-caller.
- **Jaylen Waddle** — ADP 30 / adp_pos_rank 14 but proj_pts 221 and proj_pos_rank 22, overpaying for a low-end WR2/flex projection.
- **Jaxson Dart** — ADP 56 / adp_pos_rank 4 at QB with proj_pts 296.54 and proj_pos_rank 11, another early QB run pick our board has outside the top 10.

**Positional read.** The market is overpaying for mid-round QBs (Caleb, Dart) while letting true top-five QB projections (Maye, Daniels, Hurts) fall, and it is fading proven RB volume (Jeanty, Saquon, Henry) in favor of name-brand early RBs whose projections do not clear the replacement bar by enough in an 8-team league.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "ADP 27 / adp_pos_rank 12 but proj_pts 259.5 slots him as proj_pos_rank 6 at RB, a clear top-tier back the market is treating like a mid RB2."
    },
    {
      "player_id": "4866",
      "name": "Saquon Barkley",
      "why": "ADP 39 / adp_pos_rank 18 against proj_pts 246.7 and proj_pos_rank 9, so a near-RB1 projection is available a full round-plus after lesser backs."
    },
    {
      "player_id": "11564",
      "name": "Drake Maye",
      "why": "ADP 72 / adp_pos_rank 8 at QB while proj_pts 320.76 is proj_pos_rank 3, elite 1QB production the market is letting slide past worse-projected passers."
    },
    {
      "player_id": "10229",
      "name": "Rashee Rice",
      "why": "ADP 48 / adp_pos_rank 23 versus proj_pts 229.3 and proj_pos_rank 12, a WR2 projection buried among WR4/5 prices."
    },
    {
      "player_id": "8112",
      "name": "Drake London",
      "why": "ADP 26 / adp_pos_rank 12 with proj_pts 250.2 and proj_pos_rank 8, so the market is missing a top-8 WR projection in the late third round of an 8-team draft."
    }
  ],
  "overvalued": [
    {
      "player_id": "9226",
      "name": "De'Von Achane",
      "why": "ADP 9 / adp_pos_rank 5 but proj_pts only 245.4 and proj_pos_rank 10, paying a top-10 pick for a mid-RB2 projection."
    },
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "ADP 16 / adp_pos_rank 9 against proj_pts 224.4 and proj_pos_rank 18, a late-WR2 price on what we have as a WR3/flex."
    },
    {
      "player_id": "11560",
      "name": "Caleb Williams",
      "why": "ADP 55 / adp_pos_rank 3 at QB while proj_pts 299.34 is only proj_pos_rank 10, so the market is drafting a replacement-tier QB as a top-3 signal-caller."
    },
    {
      "player_id": "7526",
      "name": "Jaylen Waddle",
      "why": "ADP 30 / adp_pos_rank 14 but proj_pts 221 and proj_pos_rank 22, overpaying for a low-end WR2/flex projection."
    },
    {
      "player_id": "12508",
      "name": "Jaxson Dart",
      "why": "ADP 56 / adp_pos_rank 4 at QB with proj_pts 296.54 and proj_pos_rank 11, another early QB run pick our board has outside the top 10."
    }
  ],
  "positional_read": "The market is overpaying for mid-round QBs (Caleb, Dart) while letting true top-five QB projections (Maye, Daniels, Hurts) fall, and it is fading proven RB volume (Jeanty, Saquon, Henry) in favor of name-brand early RBs whose projections do not clear the replacement bar by enough in an 8-team league.",
  "headline": "Take Jeanty and Saquon a round after the market, wait on Maye, and skip the mid-QB run.",
  "confidence": 0.78
}
```
</details>

## Gemini 3.1 Pro

> Capitalize on mispriced wide receivers and wait on quarterbacks to dominate your 8-team draft.

**Confidence 0.85**

**Undervalued**

- **Ashton Jeanty** — His adp of 27 is too low considering his proj_pts of 259.5 give him a proj_pos_rank of 6.
- **Emeka Egbuka** — His adp of 77 is a massive bargain for a player with 224 proj_pts, resulting in a proj_pos_rank of 19.
- **Parker Washington** — The market has him at an adp of 84, but his 212.4 proj_pts earn him a proj_pos_rank of 24.
- **Brian Thomas** — He is a steal at an adp of 99, as his 195.4 proj_pts place him at a proj_pos_rank of 30.
- **Jadarian Price** — Available at an adp of 131, his 170 proj_pts make him a solid value with a proj_pos_rank of 27.

**Overvalued**

- **Tee Higgins** — His adp of 16 is far too high for a player with a proj_pos_rank of 18 and only 224.4 proj_pts.
- **De'Von Achane** — Spending an adp of 9 on him is a reach when his 245.4 proj_pts give him a proj_pos_rank of 10.
- **Jameson Williams** — His adp of 38 is too early for a receiver with a proj_pos_rank of 28 and 206.2 proj_pts.
- **Jalen Coker** — Drafting him at an adp of 54 is a mistake when his 165.9 proj_pts result in a proj_pos_rank of 48.
- **Stefon Diggs** — His adp of 83 is heavily inflated compared to his proj_pos_rank of 52 and 163 proj_pts.

**Positional read.** The market is overvaluing name-brand wide receivers in the early-to-middle rounds while undervaluing emerging talent at both running back and wide receiver. Because this is a 1-QB league, drafters should wait on quarterbacks since the point differential between the top options and replacement level is minimal, instead loading up on mispriced skill position players.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "His adp of 27 is too low considering his proj_pts of 259.5 give him a proj_pos_rank of 6."
    },
    {
      "player_id": "12514",
      "name": "Emeka Egbuka",
      "why": "His adp of 77 is a massive bargain for a player with 224 proj_pts, resulting in a proj_pos_rank of 19."
    },
    {
      "player_id": "9487",
      "name": "Parker Washington",
      "why": "The market has him at an adp of 84, but his 212.4 proj_pts earn him a proj_pos_rank of 24."
    },
    {
      "player_id": "11631",
      "name": "Brian Thomas",
      "why": "He is a steal at an adp of 99, as his 195.4 proj_pts place him at a proj_pos_rank of 30."
    },
    {
      "player_id": "13286",
      "name": "Jadarian Price",
      "why": "Available at an adp of 131, his 170 proj_pts make him a solid value with a proj_pos_rank of 27."
    }
  ],
  "overvalued": [
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "His adp of 16 is far too high for a player with a proj_pos_rank of 18 and only 224.4 proj_pts."
    },
    {
      "player_id": "9226",
      "name": "De'Von Achane",
      "why": "Spending an adp of 9 on him is a reach when his 245.4 proj_pts give him a proj_pos_rank of 10."
    },
    {
      "player_id": "8148",
      "name": "Jameson Williams",
      "why": "His adp of 38 is too early for a receiver with a proj_pos_rank of 28 and 206.2 proj_pts."
    },
    {
      "player_id": "11646",
      "name": "Jalen Coker",
      "why": "Drafting him at an adp of 54 is a mistake when his 165.9 proj_pts result in a proj_pos_rank of 48."
    },
    {
      "player_id": "2449",
      "name": "Stefon Diggs",
      "why": "His adp of 83 is heavily inflated compared to his proj_pos_rank of 52 and 163 proj_pts."
    }
  ],
  "positional_read": "The market is overvaluing name-brand wide receivers in the early-to-middle rounds while undervaluing emerging talent at both running back and wide receiver. Because this is a 1-QB league, drafters should wait on quarterbacks since the point differential between the top options and replacement level is minimal, instead loading up on mispriced skill position players.",
  "headline": "Capitalize on mispriced wide receivers and wait on quarterbacks to dominate your 8-team draft.",
  "confidence": 0.85
}
```
</details>

## Muse Spark 1.1

> Market is drafting WR4 projections at WR2 prices while leaving RB1 projections on the board in round 4-5.

**Confidence 0.64**

**Undervalued**

- **Saquon Barkley** — RB value matters in 2-RB + FLEX and his adp_pos_rank is 18 but proj_pos_rank is 9 with proj_pts 246.7 at adp 39.
- **Rashee Rice** — Market has him at adp_pos_rank 23 WR at adp 48 but our proj_pos_rank is 12 WR with proj_pts 229.3.
- **Emeka Egbuka** — Going at adp 77 as WR33 but proj_pos_rank is 19 WR with proj_pts 224.0, a 14-spot WR gap.
- **Parker Washington** — ADP 84 as WR37 vs proj_pos_rank 24 WR with proj_pts 212.4, cheap WR3 projection in WR4 range.
- **Ashton Jeanty** — RB12 at adp 27 but proj_pos_rank 6 RB with proj_pts 259.5, RB1 projection at RB2 price.

**Overvalued**

- **Tee Higgins** — Drafted as WR9 at adp 16 but proj_pos_rank is 18 WR with proj_pts 224.4, paying WR1 for WR2 projection.
- **Jalen Coker** — ADP 54 as WR27 but proj_pos_rank is 48 WR with proj_pts 165.9, massive negative gap.
- **Jaylen Waddle** — ADP 30 as WR14 vs proj_pos_rank 22 WR with proj_pts 221.0, early pick for mid-range projection.
- **Josh Downs** — ADP 46 as WR22 but proj_pos_rank is 35 WR with proj_pts 180.4, market 13 spots too high.
- **Jameson Williams** — ADP 38 as WR17 vs proj_pos_rank 28 WR with proj_pts 206.2, paying for upside not in projection.

**Positional read.** In this 1-QB, 8-team league the market overpays QBs and mid-round WRs (WR22-WR35) while undervaluing RBs outside the top 10 and late WRs with WR2/WR3 projections.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "4866",
      "name": "Saquon Barkley",
      "why": "RB value matters in 2-RB + FLEX and his adp_pos_rank is 18 but proj_pos_rank is 9 with proj_pts 246.7 at adp 39."
    },
    {
      "player_id": "10229",
      "name": "Rashee Rice",
      "why": "Market has him at adp_pos_rank 23 WR at adp 48 but our proj_pos_rank is 12 WR with proj_pts 229.3."
    },
    {
      "player_id": "12514",
      "name": "Emeka Egbuka",
      "why": "Going at adp 77 as WR33 but proj_pos_rank is 19 WR with proj_pts 224.0, a 14-spot WR gap."
    },
    {
      "player_id": "9487",
      "name": "Parker Washington",
      "why": "ADP 84 as WR37 vs proj_pos_rank 24 WR with proj_pts 212.4, cheap WR3 projection in WR4 range."
    },
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "RB12 at adp 27 but proj_pos_rank 6 RB with proj_pts 259.5, RB1 projection at RB2 price."
    }
  ],
  "overvalued": [
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "Drafted as WR9 at adp 16 but proj_pos_rank is 18 WR with proj_pts 224.4, paying WR1 for WR2 projection."
    },
    {
      "player_id": "11646",
      "name": "Jalen Coker",
      "why": "ADP 54 as WR27 but proj_pos_rank is 48 WR with proj_pts 165.9, massive negative gap."
    },
    {
      "player_id": "7526",
      "name": "Jaylen Waddle",
      "why": "ADP 30 as WR14 vs proj_pos_rank 22 WR with proj_pts 221.0, early pick for mid-range projection."
    },
    {
      "player_id": "9500",
      "name": "Josh Downs",
      "why": "ADP 46 as WR22 but proj_pos_rank is 35 WR with proj_pts 180.4, market 13 spots too high."
    },
    {
      "player_id": "8148",
      "name": "Jameson Williams",
      "why": "ADP 38 as WR17 vs proj_pos_rank 28 WR with proj_pts 206.2, paying for upside not in projection."
    }
  ],
  "positional_read": "In this 1-QB, 8-team league the market overpays QBs and mid-round WRs (WR22-WR35) while undervaluing RBs outside the top 10 and late WRs with WR2/WR3 projections.",
  "headline": "Market is drafting WR4 projections at WR2 prices while leaving RB1 projections on the board in round 4-5.",
  "confidence": 0.64
}
```
</details>

## DeepSeek V4 Pro

> Saquon Barkley and Ashton Jeanty are screaming values at their current ADPs, while early-round WRs like Tee Higgins and Jaylen Waddle are traps.

**Confidence 0.8**

**Undervalued**

- **Chase Brown** — ADP 14 as RB7 but our proj_pos_rank is 7 with 255.2 pts, offering RB1 production at a late-first price in a scarce position.
- **Ashton Jeanty** — ADP 27 as RB12 yet proj_pos_rank is 6 with 259.5 pts, a massive discount on a high-end RB1.
- **Saquon Barkley** — ADP 39 as RB18 but proj_pos_rank is 9 with 246.7 pts, a top-10 RB available in the fourth round.
- **Drake Maye** — ADP 72 as QB8 but proj_pos_rank is 3 with 320.76 pts, an elite QB1 going far later than his projection warrants.
- **Rashee Rice** — ADP 48 as WR23 but proj_pos_rank is 12 with 229.3 pts, a high-end WR2 available in the fifth round.

**Overvalued**

- **De'Von Achane** — ADP 9 as RB5 but proj_pos_rank is 10 with 245.4 pts, paying top-10 draft capital for low-end RB2 production.
- **Tee Higgins** — ADP 16 as WR9 but proj_pos_rank is 18 with 224.4 pts, a second-round price for a mid-WR2 projection.
- **Jaylen Waddle** — ADP 30 as WR14 but proj_pos_rank is 22 with 221.0 pts, a third-round pick on a WR3 projection.
- **Brock Bowers** — ADP 17 as TE1 but proj_pos_rank is 1 with 253.5 pts, the positional advantage is real but a second-round pick on a tight end is too steep in 1-TE leagues.
- **Caleb Williams** — ADP 55 as QB3 but proj_pos_rank is 10 with 299.34 pts, paying a premium for a mid-QB1 in a shallow QB market.

**Positional read.** The market is over-drafting wide receivers and tight ends early while undervaluing running backs and quarterbacks with elite projections, likely chasing last year's positional scarcity narratives.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "9224",
      "name": "Chase Brown",
      "why": "ADP 14 as RB7 but our proj_pos_rank is 7 with 255.2 pts, offering RB1 production at a late-first price in a scarce position."
    },
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "ADP 27 as RB12 yet proj_pos_rank is 6 with 259.5 pts, a massive discount on a high-end RB1."
    },
    {
      "player_id": "4866",
      "name": "Saquon Barkley",
      "why": "ADP 39 as RB18 but proj_pos_rank is 9 with 246.7 pts, a top-10 RB available in the fourth round."
    },
    {
      "player_id": "11564",
      "name": "Drake Maye",
      "why": "ADP 72 as QB8 but proj_pos_rank is 3 with 320.76 pts, an elite QB1 going far later than his projection warrants."
    },
    {
      "player_id": "10229",
      "name": "Rashee Rice",
      "why": "ADP 48 as WR23 but proj_pos_rank is 12 with 229.3 pts, a high-end WR2 available in the fifth round."
    }
  ],
  "overvalued": [
    {
      "player_id": "9226",
      "name": "De'Von Achane",
      "why": "ADP 9 as RB5 but proj_pos_rank is 10 with 245.4 pts, paying top-10 draft capital for low-end RB2 production."
    },
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "ADP 16 as WR9 but proj_pos_rank is 18 with 224.4 pts, a second-round price for a mid-WR2 projection."
    },
    {
      "player_id": "7526",
      "name": "Jaylen Waddle",
      "why": "ADP 30 as WR14 but proj_pos_rank is 22 with 221.0 pts, a third-round pick on a WR3 projection."
    },
    {
      "player_id": "11604",
      "name": "Brock Bowers",
      "why": "ADP 17 as TE1 but proj_pos_rank is 1 with 253.5 pts, the positional advantage is real but a second-round pick on a tight end is too steep in 1-TE leagues."
    },
    {
      "player_id": "11560",
      "name": "Caleb Williams",
      "why": "ADP 55 as QB3 but proj_pos_rank is 10 with 299.34 pts, paying a premium for a mid-QB1 in a shallow QB market."
    }
  ],
  "positional_read": "The market is over-drafting wide receivers and tight ends early while undervaluing running backs and quarterbacks with elite projections, likely chasing last year's positional scarcity narratives.",
  "headline": "Saquon Barkley and Ashton Jeanty are screaming values at their current ADPs, while early-round WRs like Tee Higgins and Jaylen Waddle are traps.",
  "confidence": 0.8
}
```
</details>

## Kimi K3

> Let your league burn top-60 picks on quarterbacks — the real edges here are Saquon Barkley at 39, Ashton Jeanty at 27, and Rashee Rice at 48.

**Confidence 0.6**

**Undervalued**

- **Rashee Rice** — Projected WR12 with 229.3 proj_pts but drafted at adp 48 as WR23, an 11-spot positional gap in a full-PPR format that rewards his profile.
- **Saquon Barkley** — Our proj_pos_rank of RB9 (246.7 proj_pts) versus an adp_pos_rank of RB18 at pick 39 is exactly the kind of running back gap that matters more than the raw points suggest.
- **Ashton Jeanty** — Projected RB6 with 259.5 proj_pts — essentially James Cook's 260.8 — yet available at adp 27 while Cook goes at 10.
- **Drake Maye** — Projected QB3 at 320.76 proj_pts but drafted as QB8 at adp 72, behind Caleb Williams who we rank QB10.
- **Emeka Egbuka** — Projected WR19 with 224.0 proj_pts against an adp_pos_rank of WR33 at pick 77, a 14-spot gap for a starter-tier wideout.

**Overvalued**

- **De'Von Achane** — Drafted 9th overall as RB5 but projected RB10 with 245.4 proj_pts, a bad place to spend a top-10 pick when RBs like Barkley and Jeanty project higher rounds later.
- **Tee Higgins** — Adp_pos_rank of WR9 at pick 16 versus a proj_pos_rank of WR18 and 224.4 proj_pts, a second-round price for a back-end WR2 projection.
- **Caleb Williams** — Paid as QB3 at adp 55 while projected QB10 with 299.34 proj_pts, a steep tax in a one-QB league where only eight quarterbacks start.
- **Josh Downs** — Drafted as WR22 at adp 46 but projected WR35 with just 180.4 proj_pts, a 13-spot gap at a scarce-pick range of the draft.
- **Jalen Coker** — Adp_pos_rank of WR27 at pick 54 against a proj_pos_rank of WR48 and 165.9 proj_pts, the widest negative gap among top-60 picks.

**Positional read.** In an eight-team, one-QB league the market is overpaying for quarterbacks early (Allen at 29, C. Williams at 55) while the projections' QB3 Maye and QB9 Purdy sit at 72 and 102, so waiting on the position is free. It is simultaneously letting projection top-16 wideouts like Rice (proj WR12), McConkey (WR15) and Nabers (WR16) fall to WR23-25 prices in the middle rounds.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "10229",
      "name": "Rashee Rice",
      "why": "Projected WR12 with 229.3 proj_pts but drafted at adp 48 as WR23, an 11-spot positional gap in a full-PPR format that rewards his profile."
    },
    {
      "player_id": "4866",
      "name": "Saquon Barkley",
      "why": "Our proj_pos_rank of RB9 (246.7 proj_pts) versus an adp_pos_rank of RB18 at pick 39 is exactly the kind of running back gap that matters more than the raw points suggest."
    },
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "Projected RB6 with 259.5 proj_pts — essentially James Cook's 260.8 — yet available at adp 27 while Cook goes at 10."
    },
    {
      "player_id": "11564",
      "name": "Drake Maye",
      "why": "Projected QB3 at 320.76 proj_pts but drafted as QB8 at adp 72, behind Caleb Williams who we rank QB10."
    },
    {
      "player_id": "12514",
      "name": "Emeka Egbuka",
      "why": "Projected WR19 with 224.0 proj_pts against an adp_pos_rank of WR33 at pick 77, a 14-spot gap for a starter-tier wideout."
    }
  ],
  "overvalued": [
    {
      "player_id": "9226",
      "name": "De'Von Achane",
      "why": "Drafted 9th overall as RB5 but projected RB10 with 245.4 proj_pts, a bad place to spend a top-10 pick when RBs like Barkley and Jeanty project higher rounds later."
    },
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "Adp_pos_rank of WR9 at pick 16 versus a proj_pos_rank of WR18 and 224.4 proj_pts, a second-round price for a back-end WR2 projection."
    },
    {
      "player_id": "11560",
      "name": "Caleb Williams",
      "why": "Paid as QB3 at adp 55 while projected QB10 with 299.34 proj_pts, a steep tax in a one-QB league where only eight quarterbacks start."
    },
    {
      "player_id": "9500",
      "name": "Josh Downs",
      "why": "Drafted as WR22 at adp 46 but projected WR35 with just 180.4 proj_pts, a 13-spot gap at a scarce-pick range of the draft."
    },
    {
      "player_id": "11646",
      "name": "Jalen Coker",
      "why": "Adp_pos_rank of WR27 at pick 54 against a proj_pos_rank of WR48 and 165.9 proj_pts, the widest negative gap among top-60 picks."
    }
  ],
  "positional_read": "In an eight-team, one-QB league the market is overpaying for quarterbacks early (Allen at 29, C. Williams at 55) while the projections' QB3 Maye and QB9 Purdy sit at 72 and 102, so waiting on the position is free. It is simultaneously letting projection top-16 wideouts like Rice (proj WR12), McConkey (WR15) and Nabers (WR16) fall to WR23-25 prices in the middle rounds.",
  "headline": "Let your league burn top-60 picks on quarterbacks — the real edges here are Saquon Barkley at 39, Ashton Jeanty at 27, and Rashee Rice at 48.",
  "confidence": 0.6
}
```
</details>

## Qwen3.7 Plus

> Target the market's overvalued veterans at wide receiver and tight end, and aggressively draft the undervalued running backs and young receivers slipping down the board.

**Confidence 0.85**

**Undervalued**

- **Saquon Barkley** — His adp_pos_rank of 18 is far worse than his proj_pos_rank of 9, making him a massive value at running back where positional scarcity amplifies his 246.7 proj_pts.
- **Ashton Jeanty** — Drafted with an adp_pos_rank of 12, he projects as the 6th best running back with 259.5 proj_pts, offering elite RB1 production at an RB2 price.
- **Rashee Rice** — He sits at adp_pos_rank 23 but holds a proj_pos_rank of 12 with 229.3 proj_pts, providing WR2 upside at a WR3 discount.
- **Emeka Egbuka** — With an adp_pos_rank of 33 and a proj_pos_rank of 19, the market is severely underestimating his 224 proj_pts at a position that demands high-volume starters.
- **Travis Etienne** — His adp_pos_rank of 26 lags well behind his proj_pos_rank of 17, and his 207.7 proj_pts make him a steal in the middle rounds at running back.

**Overvalued**

- **De'Von Achane** — Despite an adp_pos_rank of 5, his proj_pos_rank is only 10 with 245.4 proj_pts, meaning the market is overpaying for him at a premium running back position.
- **Tee Higgins** — He is being drafted at adp_pos_rank 9 but projects as the 18th wide receiver with just 224.4 proj_pts, a significant overpay for a WR2.
- **Jaylen Waddle** — The market has him at adp_pos_rank 14, but his proj_pos_rank is 22 with 221 proj_pts, making him a poor value at a deep wide receiver position.
- **Travis Kelce** — Drafted at adp_pos_rank 7, his proj_pos_rank is 9 with 171.4 proj_pts, and the tight end position doesn't offer enough positional scarcity to justify this premium.
- **Calvin Ridley** — With an adp_pos_rank of 66 but a proj_pos_rank of 80 and only 77.3 proj_pts, he is a late-round draft pick that the market is treating as a viable fantasy option.

**Positional read.** The market is overvaluing veteran wide receivers and tight ends who no longer provide elite positional scarcity, while simultaneously undervaluing high-upside running backs and emerging young receivers.

<details><summary>Raw response</summary>

```json
{
  "undervalued": [
    {
      "player_id": "4866",
      "name": "Saquon Barkley",
      "why": "His adp_pos_rank of 18 is far worse than his proj_pos_rank of 9, making him a massive value at running back where positional scarcity amplifies his 246.7 proj_pts."
    },
    {
      "player_id": "12527",
      "name": "Ashton Jeanty",
      "why": "Drafted with an adp_pos_rank of 12, he projects as the 6th best running back with 259.5 proj_pts, offering elite RB1 production at an RB2 price."
    },
    {
      "player_id": "10229",
      "name": "Rashee Rice",
      "why": "He sits at adp_pos_rank 23 but holds a proj_pos_rank of 12 with 229.3 proj_pts, providing WR2 upside at a WR3 discount."
    },
    {
      "player_id": "12514",
      "name": "Emeka Egbuka",
      "why": "With an adp_pos_rank of 33 and a proj_pos_rank of 19, the market is severely underestimating his 224 proj_pts at a position that demands high-volume starters."
    },
    {
      "player_id": "7543",
      "name": "Travis Etienne",
      "why": "His adp_pos_rank of 26 lags well behind his proj_pos_rank of 17, and his 207.7 proj_pts make him a steal in the middle rounds at running back."
    }
  ],
  "overvalued": [
    {
      "player_id": "9226",
      "name": "De'Von Achane",
      "why": "Despite an adp_pos_rank of 5, his proj_pos_rank is only 10 with 245.4 proj_pts, meaning the market is overpaying for him at a premium running back position."
    },
    {
      "player_id": "6801",
      "name": "Tee Higgins",
      "why": "He is being drafted at adp_pos_rank 9 but projects as the 18th wide receiver with just 224.4 proj_pts, a significant overpay for a WR2."
    },
    {
      "player_id": "7526",
      "name": "Jaylen Waddle",
      "why": "The market has him at adp_pos_rank 14, but his proj_pos_rank is 22 with 221 proj_pts, making him a poor value at a deep wide receiver position."
    },
    {
      "player_id": "1466",
      "name": "Travis Kelce",
      "why": "Drafted at adp_pos_rank 7, his proj_pos_rank is 9 with 171.4 proj_pts, and the tight end position doesn't offer enough positional scarcity to justify this premium."
    },
    {
      "player_id": "4981",
      "name": "Calvin Ridley",
      "why": "With an adp_pos_rank of 66 but a proj_pos_rank of 80 and only 77.3 proj_pts, he is a late-round draft pick that the market is treating as a viable fantasy option."
    }
  ],
  "positional_read": "The market is overvaluing veteran wide receivers and tight ends who no longer provide elite positional scarcity, while simultaneously undervaluing high-upside running backs and emerging young receivers.",
  "headline": "Target the market's overvalued veterans at wide receiver and tight end, and aggressively draft the undervalued running backs and young receivers slipping down the board.",
  "confidence": 0.85
}
```
</details>
