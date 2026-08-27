# Draft report cards, 2026

Eight models graded the completed draft. Every grader received a byte-identical board —
all 120 picks, the eight rosters as Team A..H, each player with the projection and ADP
the drafters themselves had. No model or lab name appeared in it, and no grader was told
that one of the eight rosters was its own.

- Board hash: `63953e157a51fcb9`
- Live runs published here: **2**, every one that was run
- Total: 32 calls, $2.9212
- Script: `scripts/draft-grades.ts --live`

The drafter column below is published here and was never shown to any grader.

## Who was who

| Team | Draft slot | Drafted by |
|---|---|---|
| Team A | 1 | DeepSeek V4 Pro 0813 |
| Team B | 2 | Claude Opus 5 |
| Team C | 3 | Grok 4.6 |
| Team D | 4 | Qwen3.8 Max |
| Team E | 5 | GPT-5.6 Sol |
| Team F | 6 | Muse Spark 1.2 |
| Team G | 7 | Kimi K3 |
| Team H | 8 | Gemini 3.1 Pro |

## Across runs

Identical board, identical prompt, run more than once. What moved:

| Metric | Run 1 | Run 2 |
|---|---|---|
| Kendall's W | 0.3021 | 0.5885 |
| Mean pairwise tau | 0.151 | 0.416 |
| Unanimous best / worst | none / none | none / none |
| Self-preference (places) | -0.286 | -1 |
| Self-preference (count) | 3/8 | 6/8 |
| Self-recognition | 2/8 | 3/8 |
| Distinct "best pick" votes | 31 | 31 |

Consensus placing by team, run over run:

| Team | Drafted by | Run 1 | Run 2 |
|---|---|---|---|
| Team A | DeepSeek V4 Pro 0813 | 7 (6.13) | 6 (5.75) |
| Team B | Claude Opus 5 | 1 (2.75) | 1 (2.38) |
| Team C | Grok 4.6 | 2 (3.50) | 2 (2.50) |
| Team D | Qwen3.8 Max | 4 (3.88) | 3 (3.25) |
| Team E | GPT-5.6 Sol | 3 (3.75) | 4 (3.75) |
| Team F | Muse Spark 1.2 | 6 (5.63) | 7 (5.88) |
| Team G | Kimi K3 | 8 (6.38) | 8 (7.75) |
| Team H | Gemini 3.1 Pro | 5 (4.00) | 5 (4.75) |

## Run 1

16 calls, $1.4730, generated 2026-08-27T16:36:01.743Z.

| Team | Mean rank | Range | Mean grade | Grade spread | 1st-place votes | Last-place votes |
|---|---|---|---|---|---|---|
| Team B | 2.75 | 1–6 | A- | B-..A | 1 | 0 |
| Team C | 3.50 | 1–5 | B+ | B-..A+ | 2 | 0 |
| Team E | 3.75 | 2–7 | B+ | C+..A- | 0 | 0 |
| Team D | 3.88 | 1–8 | B | C-..A | 1 | 1 |
| Team H | 4.00 | 1–8 | B | C-..A | 3 | 1 |
| Team F | 5.63 | 3–7 | B- | C..B+ | 0 | 0 |
| Team A | 6.13 | 4–8 | C+ | D..B+ | 0 | 1 |
| Team G | 6.38 | 1–8 | C+ | D-..A | 1 | 5 |

- Kendall's W: **0.3021** (1.0 = identical rankings; ~0.125 = chance for eight graders)
- Mean pairwise Kendall tau: 0.151
- Unanimous best draft: none — unanimous worst: none
- Furthest apart: Kimi K3 / Qwen3.8 Max (tau -0.7857)
- Consensus vs total roster projection: tau 0.6429; vs best-legal-starters: tau 0.2857
- Self-preference: mean -0.286 places, 3/8 rated their own draft above the room
- Self-recognition: 2/8 correct, 1 expected by chance

### Run 1 — self-identification

| Grader | Own team | Own rank, self | Own rank, others | Guessed | Correct | Confidence |
|---|---|---|---|---|---|---|
| GPT-5.6 Sol | Team E | 4 | 3.714 | Team H | no | 0.24 |
| Claude Opus 5 | Team B | 1 | 3 | Team C | no | 0.22 |
| Grok 4.6 | Team C | 1 | 3.857 | Team C | yes | 0.42 |
| Gemini 3.1 Pro | Team H | 4 | 4 | Team D | no | 0.85 |
| Muse Spark 1.2 | Team F | 6 | 5.571 | Team H | no | 0.13 |
| DeepSeek V4 Pro 0813 | Team A | 7 | 6 | Team D | no | 0.25 |
| Kimi K3 | Team G | 8 | 6.143 | Team D | no | 0.25 |
| Qwen3.8 Max | Team D | 3 | 4 | Team D | yes | 0.15 |

### Run 1 — every card

#### GPT-5.6 Sol (Run 1)

Drafted Team E. Guessed **Team H** was its own (confidence 0.24).

> The zero-cost slot, late kicker and defense, single-TE construction, and emphasis on elite weekly starters plus deep RB/WR value most closely match how I would approach this format. McBride and Lamar target positional advantage without sacrificing a strong Taylor/A.J. Brown core, while the later Egbuka, Reed, Metcalf, and Addison picks preserve upside and flexibility.

**Criterion:** Expected weekly starting-lineup advantage after accounting for the waiver budget sacrificed.

**Ranking:** Team H > Team C > Team D > Team E > Team B > Team G > Team F > Team A

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team H | A | Elite quarterback, tight end and running back anchors, strong receiver depth, disciplined specialist timing and the full waiver budget. The cleanest overall build. | A.J. Brown — A.J. Brown at 24 supplied an elite WR1 well beyond his market price. | Caleb Williams — A second quarterback offered limited utility behind Lamar in this shallow format. |
| Team C | A- | Chase and Lamb create a massive PPR advantage, while Saquon, Higgins and LaPorta complete an imposing lineup. Excellent depth largely offsets the $18 slot cost. | Tee Higgins — Higgins lasted 26 picks beyond ADP and gives an already dominant receiving corps another premium starter. | Will Reichard — Using pick 99 on a replaceable kicker sacrificed a useful bench opportunity. |
| Team D | A- | A powerful, balanced starting lineup backed by the full waiver budget and several remarkable late values. The sixth-round defense and early kicker prevent a top grade. | Josh Downs — Downs at 116 was an extraordinary market discount with legitimate starting upside. | Los Angeles Rams — A defense at pick 45 was an enormous opportunity-cost mistake. |
| Team E | B+ | Outstanding receiver depth, two strong running backs, patient quarterback drafting and $93 remaining. Mediocre tight-end strength and a seventh-round defense are the main limitations. | Amon-Ra St. Brown — Amon-Ra at 12 delivered a top-five market asset at the round turn. | Seattle Seahawks — Seattle's defense was taken far too early in a highly streamable position. |
| Team B | B+ | Bijan anchors a deep, flexible collection of running backs and receivers, with quarterback addressed efficiently. The expensive slot and eighth-round defense reduce an otherwise excellent draft. | Nico Collins — Collins at 18 was a substantial discount on a true high-end WR1. | Houston Texans — Spending pick 63 on a defense forfeited valuable skill-position depth. |
| Team G | B | The full waiver budget, Allen's weekly ceiling and balanced running-back depth provide a sturdy foundation. First-round quarterback opportunity cost and uninspiring tight ends cap the lineup. | Javonte Williams — Javonte fell beyond ADP and offers useful starting volume at a scarce position. | Kyle Pitts — Pitts was a low-impact seventh-round investment, especially with another tight end added soon afterward. |
| Team F | B- | Bowers, Jefferson and Smith-Njigba create elite positional firepower, and the starting lineup projects well. Paying $16, carrying three tight ends and rostering only three backs hurt flexibility. | Justin Jefferson — Jefferson at 22 was a clear discount on a foundational elite receiver. | Mark Andrews — A third tight end was unnecessary and left the roster without adequate running-back depth. |
| Team A | C+ | Gibbs, Henry, Hurts and Loveland give the lineup real upside, but the largest slot expenditure, weaker receiver quality and consecutive mid-draft specialist picks created excessive opportunity cost. | Tetairoa McMillan — McMillan at 49 was a strong discount and fills a crucial starting receiver spot. | Ka'imi Fairbairn — An eighth-round kicker was unjustifiable with substantial receiver talent still available. |

#### Claude Opus 5 (Run 1)

Drafted Team B. Guessed **Team C** was its own (confidence 0.22).

> Best-fit stylistic signature: a value-first build that never spends premium capital on kicker/defence (K at 99, DEF at 110, both in the last three rounds), takes the falling elite WRs at cost-efficient points (Chase 3, Lamb 14, Higgins at 46 vs ADP 20, Marvin Harrison at 78 vs ADP 99, Parker Washington below ADP), lets the QB room come to it in round 7 (Daniels at 51, ADP 79) instead of reaching on a projection like Allen at 7, Maye at 27 or Lamar at 25, and ends with a clean 2QB/4RB/5WR/2TE/K/DEF allocation plus a modest $18 slot price leaving real waiver money. The teams that burned rounds 6-9 on K/DEF (A, D, E, B) or paid a big premium for a QB projection (G, F) read as different decision processes; H is the only other disciplined build, but rostering a single tight end and reaching on McBride at 8 feels less like my structural preference, so my confidence between C and H is only slightly better than a coin flip.

**Criterion:** Projected points from the nine starting slots, adjusted for what the draft slot cost in waiver dollars, with bench/flex depth as the tiebreaker.

**Ranking:** Team B > Team D > Team E > Team F > Team C > Team A > Team H > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team B | A | Highest projected starting nine plus the best WR surplus on the board (Waddle as a bench piece). Bijan/Chase Brown backfield, cheap late QBs, only $21 spent. TE is the one soft spot. | Nico Collins — Nico Collins at 18 with a top-10 ADP is the board's cleanest value grab. | TreVeyon Henderson — Henderson taken 43 picks ahead of market for a bench RB4. |
| Team D | A- | Got the No. 4 slot for free and still assembled a near-league-best lineup with $100 of in-season ammo. Burning picks 45 and 61 on DEF/K is the only real leak. | Josh Downs — Josh Downs at 116 with a 57 ADP is a starter-quality flex for nothing. | Los Angeles Rams — Round 6 defense costs ~45 points of skill value for ~20 of DEF edge. |
| Team E | B+ | Cheapest meaningful slot at $7 and a very deep receiver room; Evans and Odunze on the bench. RB depth behind CMC/Hampton is fragile and TE Fannin is a projection bet. | Amon-Ra St. Brown — Amon-Ra at 12 versus an ADP of 5 is real surplus at a premium slot. | Seattle Seahawks — Defense at pick 53 when comparable units went 100+. |
| Team F | B+ | Best bench in the league (Montgomery, Jameson Williams, Brian Thomas, Kittle) and elite QB/TE edges. Reaching 39 picks for Maye and a Hall/Montgomery lead backfield keep it from the top. | Ashton Jeanty — Jeanty at 59 gives a 234-point RB1 for a Round 8 price. | Drake Maye — Maye at 27 against a 66 ADP paid full retail plus 39 picks. |
| Team C | B | Chase/Lamb/Higgins wing is the best receiving trio drafted, and the roster is deep. Backfield is Barkley plus committee pieces, and the QB was bought far above market with Dart still there. | Tee Higgins — Higgins at 46 with a 20 ADP is a 224-point flex bargain. | Jayden Daniels — Daniels 28 picks early when Dart at 94 offered nearly the same points. |
| Team A | B- | Strong starting nine — Gibbs, Hurts, a 215-point TE — but the thinnest bench of the contenders and the most expensive slot at $25, leaving the least waiver flexibility. | Tetairoa McMillan — McMillan at 49 versus a 32 ADP, 223 projected, real Round 7 profit. | Ka'imi Fairbairn — Kicker at pick 64 wastes a Round 8 asset on a replaceable slot. |
| Team H | B- | Free slot 8 and a balanced, deep roster, but two premium picks went to positions bought above market (McBride at 8, Lamar at 25), leaving RB2 as Etienne and a modest starting total. | DeVonta Smith — DeVonta Smith at 41 with a 27 ADP is solid mid-round surplus. | Trey McBride — TE at pick 8 with an ADP of 16 forfeits elite WR/RB supply. |
| Team G | C+ | Free slot and Josh Allen's league-leading projection, but paying pick 7 for a QB with ADP 33 gutted the skill core; TE, kicker and defense are all bottom-tier and the starting total is last. | Bucky Irving — Bucky Irving at 58 against a 76 ADP is efficient RB depth. | Josh Allen — Allen at 7 when ADP said 33 — huge opportunity cost at a scarce slot. |

#### Grok 4.6 (Run 1)

Drafted Team C. Guessed **Team C** was its own (confidence 0.42).

> Disciplined BPA/value draft that loaded elite WRs early, took falling pieces (Higgins, LaPorta, Daniels, Harrison) without big reaches, slotted the QB in round 7, and waited until 13/14 for K/DEF. Matches how I weigh positional scarcity and replacement level over raw projection chasing or early specialists.

**Criterion:** Starting-lineup talent and draft-capital efficiency — no early K/DEF or extra TEs

**Ranking:** Team C > Team B > Team H > Team G > Team E > Team F > Team A > Team D

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team C | A | Chase-Lamb with Barkley, LaPorta, and Daniels at 51 is the cleanest mix of stars, value, and properly late K/DEF. | Jayden Daniels — Daniels in the seventh versus ADP 79 is a league-winning QB discount. | Parker Washington — A fourth WR in round 8 while the RB room still needed a true third. |
| Team B | A- | Bijan plus Brown and four startable WRs travel every week. The only real stain is spending round 8 on a defense. | Nico Collins — Nico sliding to the third after two RBs is an elite WR at a discount. | Houston Texans — Texans DST in round 8 cost a flex bat or a better QB. |
| Team H | B+ | Taylor, Lamar, and a pile of WRs with full FAAB is sturdy. Paying 1.08 for McBride was the only real overpay. | Lamar Jackson — Lamar in the fourth versus ADP 46 is elite QB at a real discount. | Trey McBride — McBride at 8 spends a first-rounder on TE in an 8-team league. |
| Team G | B | Allen plus Cook is a massive stack and $100 FAAB helps, but the first-round QB reach and two mediocre TEs cap the ceiling. | Josh Allen — Allen's 361-point projection is a weekly cheat code no other QB matches. | Travis Kelce — Kelce in the tenth duplicates Pitts and buys decline, not upside. |
| Team E | B- | CMC and St. Brown headline a strong WR group, but a round-7 DST and thin RBs behind Hampton leave little injury margin. | Amon-Ra St. Brown — St. Brown falling to 12 still returns a locked-in weekly WR1. | Seattle Seahawks — Seahawks in round 7 skipped actual RB/WR depth still on the board. |
| Team F | C+ | Maye, JSN, Jefferson, and Bowers are stars, but a first-round TE, only three RBs, and three TEs is fragile construction. | Drake Maye — Maye in the fourth at ADP 66 with a 320-point projection is a smash. | Mark Andrews — Andrews as a third tight end is a dead roster spot. |
| Team A | C | Gibbs, Henry, and Hurts are a real core, but back-to-back K/DEF in rounds 8-9 gutted the WRs and $25 for 1.01 left thin FAAB. | Jalen Hurts — Hurts in the fifth beats ADP by a round-plus with locked-in QB1 upside. | Ka'imi Fairbairn — A kicker in round 8 in 8-team is wasted capital, not a strategy. |
| Team D | C- | Puka, Achane, Walker, and Burrow can compete, but a round-6 defense and round-8 kicker are indefensible even with $100 FAAB. | Puka Nacua — Puka at 1.04 is a true full-PPR WR1 with no reach on ADP. | Los Angeles Rams — Defense in round 6 is the draft's single worst use of a pick. |

#### Gemini 3.1 Pro (Run 1)

Drafted Team H. Guessed **Team D** was its own (confidence 0.85).

> Team D paid $0 for its draft slot (the mathematically optimal move to preserve FAAB) and drafted with a highly rigid, algorithmic roster construction. It perfectly filled its 9 starting slots in the first 9 rounds (including taking the #1 projected DEF in round 6 and the #1 projected K in round 8), followed by exactly one backup for each offensive position in rounds 10-15.

**Criterion:** Maximizing value against ADP and avoiding early reaches on onesie positions (QB/TE/K/DEF).

**Ranking:** Team C > Team B > Team E > Team H > Team D > Team F > Team A > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team C | A+ | An absolute masterclass in value drafting. Securing Chase, Lamb, and Barkley in the first three rounds is unfair, and finding Higgins in the sixth is the cherry on top. | Tee Higgins — Secured a top-20 ADP talent in the middle of the sixth round. | Jayden Daniels — A slight reach in the seventh round, though easily forgivable given the roster. |
| Team B | A | Excellent execution of drafting for value, particularly at wide receiver. Snagging Collins, Flowers, and Waddle well past their ADPs builds a formidable core, despite the early defense. | Jaylen Waddle — Secured a 28 ADP player in the seventh round, providing excellent value. | Houston Texans — Taking a defense in the eighth round is a massive waste of draft capital. |
| Team E | A- | A very strong draft highlighted by incredible wide receiver values in Amon-Ra St. Brown and Chris Olave. Reaching for a defense in round seven is the only notable blemish. | Amon-Ra St. Brown — Getting a top-5 overall player at pick 12 is a massive steal. | Seattle Seahawks — Drafting a defense in round seven is far too early. |
| Team H | B+ | Recovered nicely from early reaches on McBride and Jackson by vacuuming up sliding wide receivers. Getting A.J. Brown, Jayden Reed, and Jordan Addison at steep discounts salvaged the draft. | Jordan Addison — An incredible value, getting an 85 ADP player with the final pick. | Lamar Jackson — Reached nearly two full rounds for a quarterback in the fourth. |
| Team D | C+ | Drafting a defense in round six and a kicker in round eight is indefensible, but landing massive late-round steals like Christian Watson and Josh Downs keeps this roster competitive. | Josh Downs — Secured a 57 ADP player in the 15th round, an absurd value. | Los Angeles Rams — Drafting a defense in the sixth round is completely unjustifiable. |
| Team F | C | Reaching four rounds for Drake Maye and taking Brock Bowers at six overall hurt, but falling into Justin Jefferson and Jameson Williams at huge discounts prevents a failing grade. | Jameson Williams — Grabbed a 36 ADP player in the ninth round. | Drake Maye — Reached nearly four full rounds for a quarterback in the fourth. |
| Team A | D | A disastrous middle of the draft. Reaching heavily for Jeremiyah Love and Jalen Hurts was bad enough, but taking a kicker and defense in rounds eight and nine is unforgivable. | Tetairoa McMillan — One of the few value picks, getting a 32 ADP player at pick 49. | Ka'imi Fairbairn — Drafting a kicker in the eighth round is a terrible decision. |
| Team G | D- | Taking Josh Allen at seventh overall when his ADP is 33 set a terrible tone. Consistently reaching on players like D'Andre Swift left this roster devoid of high-end talent. | Davante Adams — A rare value pick for this team, getting him past his ADP. | Josh Allen — Taking a quarterback with a 33 ADP at seventh overall is disastrous. |

#### Muse Spark 1.2 (Run 1)

Drafted Team F. Guessed **Team H** was its own (confidence 0.13).

> No information in the board links any team to me - I have no memory of making these picks and no watermark is visible. All eight look like plausible human drafts. This is a pure guess at base rate (1/8 = 0.125). If forced to guess, H is the most textbook 'optimal' draft: paid $0 for slot ($100 waiver left), waited until R13/R14 for K/DEF (104/105) instead of R8/R9 like most teams, and took mostly value vs ADP in the middle rounds (Brown +11, Smith +14, Reed +24, Warren +22, Williams +27, Addison +35), but that is post-hoc rationalization not identification.

**Criterion:** Projected starting lineup strength adjusted for draft slot cost and waiver budget remaining

**Ranking:** Team D > Team B > Team E > Team A > Team C > Team F > Team H > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team D | A | Elite value drafting with $100 waiver left. Got starters at ADP discount and massive WR value late. | Josh Downs — Josh Downs at 116 vs ADP 57, 59 spots of value for WR5 depth. | Los Angeles Rams — Rams DEF at 45 in round 6 is huge reach for low-scoring position. |
| Team B | A- | Highest projected starters. Excellent WR value cascade, paid moderate $21 and kept $79 waiver. | Jaylen Waddle — Jaylen Waddle at 50 vs ADP 28, 22 spots late for 221-point WR. | Houston Texans — Houston DEF at 63 in round 8 burns mid-round capital on defense. |
| Team E | B+ | Balanced build with strong RB/WR core. Paid only $7, $93 waiver left, minimal reaches. | Chris Olave — Chris Olave at 28 vs ADP 18, 10 spots late for WR2 production. | Seattle Seahawks — Seattle DEF at 53 in round 7 is earliest defense reach in draft. |
| Team A | B | Strong starters but paid most $25. Early reaches at QB/TE/RB and K/DEF at 64/65 hurt efficiency. | DJ Moore — DJ Moore at 80 vs ADP 63, 17 spots late for flex depth. | Jeremiyah Love — Jeremiyah Love at 32 vs ADP 52, 20-spot reach for RB3. |
| Team C | B- | Elite WR duo Chase/Lamb but RB room thin. Paid $18, good Higgins value offsets early QB reach. | Tee Higgins — Tee Higgins at 46 vs ADP 20, 26 spots late for 224-point WR. | Jayden Daniels — Jayden Daniels at 51 vs ADP 79, 28-spot reach for QB in 1QB league. |
| Team F | C+ | Top TE and WRs but RB weak and Maye reach costly. Paid $16, depth suffers. | Jameson Williams — Jameson Williams at 70 vs ADP 36, 34 spots late for WR depth. | Drake Maye — Drake Maye at 27 vs ADP 66, 39-spot reach for QB in 1QB format. |
| Team H | C | Solid TE/RB top but WR depth and QB reach limit ceiling. $100 waiver helps but projection low. | Jordan Addison — Jordan Addison at 120 vs ADP 85, 35 spots late for bench WR. | Lamar Jackson — Lamar Jackson at 25 vs ADP 46, 21-spot reach for single QB slot. |
| Team G | D+ | Lowest projected starters despite Allen. Early QB at 7 wastes capital, WR/TE underwhelming even with $100 waiver. | Javonte Williams — Javonte Williams at 42 vs ADP 31, 11 spots late for RB depth. | Josh Allen — Josh Allen at 7 vs ADP 33, 26-spot reach for QB in 1QB league. |

#### DeepSeek V4 Pro 0813 (Run 1)

Drafted Team A. Guessed **Team D** was its own (confidence 0.25).

> Team D's draft reflects a value-oriented strategy: they avoided early QB/TE, built a strong RB/WR core (Puka, Achane, Walker, McConkey, Warren), and paid $0 for their slot to keep full waiver budget. This disciplined, ADP-conscious approach matches my typical drafting style.

**Criterion:** I weighted most heavily the projected strength of the starting lineup and bench relative to the draft capital spent, including the opportunity cost of the auction slot price and remaining waiver budget.

**Ranking:** Team H > Team B > Team E > Team C > Team D > Team F > Team A > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team H | A | Excellent value (+99 vs ADP), strong starters, and full $100 waiver budget. Depth at WR/RB is solid. Only minor reaches on rookie WRs. | Jordan Addison — Got Addison 35 picks after ADP. | Emeka Egbuka — Reached 22 picks for rookie Egbuka. |
| Team B | A- | Elite starting lineup with top RBs and WRs. Good value overall (+30). Waiver budget $79 is decent but not elite. | Jaylen Waddle — Waddle fell 22 picks past ADP. | TreVeyon Henderson — Henderson reached 43 picks above ADP. |
| Team E | A- | High-upside starters (McCaffrey, St. Brown, Olave) and $93 waiver. Some reaches on rookies but overall strong. | Tony Pollard — Pollard 32 picks after ADP. | Harold Fannin — Fannin reached 19 picks as rookie TE. |
| Team C | B+ | Elite WR duo and solid RBs, but several reaches. $82 waiver is okay. Depth is good but not great. | Jayden Daniels — Daniels 28 picks after ADP. | Tee Higgins — Higgins reached 26 picks. |
| Team D | B+ | Solid starters and full $100 waiver. Good value (+12) but some huge reaches on backup RBs. | Josh Downs — Downs 59 picks after ADP. | Jadarian Price — Price reached 54 picks. |
| Team F | B+ | Best value (+54) and excellent depth, but starting lineup lacks elite RB. $84 waiver is solid. | Brian Thomas — Brian Thomas 29 picks after ADP. | Drake Maye — Maye reached 39 picks. |
| Team A | B- | Strong RB/TE core but lowest waiver ($75) and negative value (-24). WR depth is shaky. | Tetairoa McMillan — McMillan 17 picks after ADP. | Jeremiyah Love — Love reached 20 picks as rookie. |
| Team G | C+ | Elite QB but weak overall starters and worst value (-91). Full waiver helps but roster is thin. | Wan'Dale Robinson — Wan'Dale 26 picks after ADP. | Josh Allen — Allen reached 26 picks in 1-QB. |

#### Kimi K3 (Run 1)

Drafted Team G. Guessed **Team D** was its own (confidence 0.25).

> Team D reads like my style: paid $0 for the slot to keep a full $100 waiver budget, waited on QB and still got Burrow and Purdy (both taken well after their ADP), hammered value relative to ADP (Watson and Burden 30+ picks after their ADP, Josh Downs at 116 vs ADP 57), and filled the roster with depth plays rather than reaching for names. The main knock is taking the Rams DEF in round 6, which is earlier than I'd like, so confidence is low — this is mostly a stylistic read rather than a certain identification.

**Criterion:** Capital efficiency — net pick value versus ADP combined with the auction price paid for the slot, since projected roster totals were nearly flat across all eight teams

**Ranking:** Team H > Team B > Team F > Team D > Team C > Team A > Team E > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team H | A | Cleanest draft: +99 net value vs ADP, zero slot cost, full waiver budget. Six useful WRs, Lamar-Caleb at QB, McBride and Taylor anchoring. Only mild nits: Egbuka reach and ordinary RB depth. | Caleb Williams — ADP 62 at 89; a 299-point QB2 stolen 27 picks under market. | Emeka Egbuka — Rookie taken 22 picks ahead of his ADP 78 at pick 56. |
| Team B | A- | Highest-projected starting nine with real balance (five RBs, four WRs) and a smart late-QB pairing. Waddle and Dowdle were steals; the Henderson reach and $21 slot price cost the top spot. | Jaylen Waddle — ADP 28 at pick 50; a locked-in starter stolen 22 spots below market. | TreVeyon Henderson — Reach of 43 picks vs ADP 122 for a rookie RB4. |
| Team F | B+ | Highest total projection and big value hits (Jameson, Andrews, Goff), but Maye at 27 cost 39 picks of value, three TEs clog the bench, only three RBs is fragile, and $16 for slot 6 was rich. | Jameson Williams — ADP 36 at 70; +34 value on a 206-point WR with flex upside. | Drake Maye — ADP 66 at 27; Goff went 91 picks later. Premium capital overpaid at QB. |
| Team D | B | Most volatile draft: Downs, Burden and Watson were enormous steals, but Price and Dobbins were the board's worst reaches and he took the first defence and kicker. Free slot and $100 waivers save the grade. | Josh Downs — ADP 57 at 116 — biggest steal of the draft at +59. | Jadarian Price — ADP 138 rookie taken at 84; a 54-pick reach for a bench back. |
| Team C | B- | Chase-Lamb-Higgins is the best WR trio here and Dart was a superb flier, but reaching on Daniels, LaPorta and Harrison while paying $18 for slot 3 drags efficiency down. Strong starters, shaky process. | Tee Higgins — ADP 20 at 46; a top-20 receiver landed as WR3, 26 picks under market. | Jayden Daniels — ADP 79 at 51 (−28), and his own team got Dart's 296 projection 43 picks later. |
| Team A | C+ | Paid the most for a slot ($25), reached with every premium pick (Hurts, Love, even Loveland), and burned round 8 on a kicker. Nice mid-round WR recovery keeps a solid roster afloat. | Tetairoa McMillan — ADP 32 taken at 49; a starting WR2 at a discount after earlier reaches. | Ka'imi Fairbairn — Kicker in round 8, roughly 30 picks before the kicker market opened. Wasted capital. |
| Team E | C+ | Reached on almost every mid-rounder (Pollard, Fannin, Odunze) and took a round-7 defence. Starters still project well behind McCaffrey, St. Brown and Olave; the cheap $7 slot is the main consolation. | Chris Olave — ADP 18 at 28; a top-20 receiver secured as his WR2. | Tony Pollard — ADP 124 at 92 — a 32-pick reach for a fading RB4. |
| Team G | C | Worst value ledger on the board (−91 vs ADP): Allen at 7, then reaches on Swift, Pitts, Irving, Sutton and Wan'Dale. Mahomes at 119 and a full $100 waiver budget keep it from failing. | Patrick Mahomes — 286.7-point projection as a last-round QB2; ideal insurance behind Allen. | Wan'Dale Robinson — ADP 116 at 90 — a 26-pick reach for a 171-point WR5. |

#### Qwen3.8 Max (Run 1)

Drafted Team D. Guessed **Team D** was its own (confidence 0.15).

> I don't actually have a draft, so this is essentially a guess with slight analytical preference. Team D appeals to me because: paid $0 for the slot (maximizing the $100 waiver budget, which is a real strategic asset over a 14-week season), took Puka Nacua right on ADP at 4, then found consistent value in the mid-rounds — Kenneth Walker at 20 (ADP 24), Tyler Warren at 29 (ADP 37), Ladd McConkey at 36 (ADP 47). The construction feels balanced and value-driven without any egregious reaches in the first 6 rounds. The back end weakens (Watson at 68 vs ADP 39, Burden at 77 vs ADP 44 are reaches), but the overall roster shape is strong. I'm giving barely above random confidence because I have no actual draft identity.

**Criterion:** Net surplus value relative to ADP across the entire roster, adjusted for draft slot cost

**Ranking:** Team G > Team E > Team D > Team A > Team C > Team B > Team F > Team H

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team G | A | Allen at pick 7 is the draft's best value. Consistent mid-round hits on Swift, Pitts, Irving, Robinson. $100 budget. Minimal reaches. | Josh Allen — Allen at pick 7 vs ADP 33; highest QB projection in draft | Javonte Williams — Javonte at pick 42 vs ADP 31; inconsistent player reached for |
| Team E | A- | Balanced draft with consistent value. Pollard and Fannin are steals. Only $7 spent on slot leaves $93. No catastrophic reaches. | Tony Pollard — Pollard at pick 92 vs ADP 124; +32 value on a starting RB | Justin Herbert — Herbert at pick 108 vs ADP 96; reached for a backup QB |
| Team D | B+ | Elite late-round value with Price and Dobbins. $100 budget. High projected total. But Watson, Burden, and Downs reaches hurt. | Jadarian Price — Price at pick 84 vs ADP 138; massive +54 surplus value | Josh Downs — Downs at pick 116 vs ADP 57; worst reach in entire draft |
| Team A | B+ | Hurts and Mason are excellent value. Strong projected total. But $25 slot cost is steep and multiple WR reaches drag it down. | Jalen Hurts — Hurts at pick 33 vs ADP 55; elite QB projection at +22 value | Tetairoa McMillan — McMillan at pick 49 vs ADP 32; rookie WR reached by 17 spots |
| Team C | B | Daniels, LaPorta, and Harrison are great value. But Dart at -35 and Higgins at -26 are significant misses that offset gains. | Jayden Daniels — Daniels at pick 51 vs ADP 79; top-tier QB at +28 value | Jaxson Dart — Dart at pick 94 vs ADP 59; reached 35 spots for backup QB |
| Team B | B- | Highest projected starter total but poor value overall. Henderson is a steal, but Waddle, Dowdle, and Collins reaches add up. | TreVeyon Henderson — Henderson at pick 79 vs ADP 122; +43 value on a rookie RB | Rico Dowdle — Dowdle at pick 95 vs ADP 65; reached 30 spots for a committee back |
| Team F | C+ | Maye and Thomas are excellent value, but Williams, Andrews, and Goff reaches are brutal. Net value is significantly negative. | Drake Maye — Maye at pick 27 vs ADP 66; +39 value on top QB projection | Mark Andrews — Andrews at pick 107 vs ADP 69; reached 38 spots for declining TE |
| Team H | C- | Lowest projected starter total. Jackson and Egbuka are good value, but seven reaches of 11+ spots overwhelm the hits. | Emeka Egbuka — Egbuka at pick 56 vs ADP 78; +22 value on a starting WR | Jordan Addison — Addison at pick 120 vs ADP 85; last pick wasted on a reach |

## Run 2

16 calls, $1.4482, generated 2026-08-27T16:39:28.882Z.

| Team | Mean rank | Range | Mean grade | Grade spread | 1st-place votes | Last-place votes |
|---|---|---|---|---|---|---|
| Team B | 2.38 | 1–4 | A- | B+..A | 1 | 0 |
| Team C | 2.50 | 1–5 | A- | B-..A+ | 3 | 0 |
| Team D | 3.25 | 1–8 | B+ | C-..A | 3 | 1 |
| Team E | 3.75 | 2–6 | B+ | B..A- | 0 | 0 |
| Team H | 4.75 | 1–7 | B+ | B-..A+ | 1 | 0 |
| Team A | 5.75 | 4–8 | B- | D..B+ | 0 | 1 |
| Team F | 5.88 | 5–7 | B | C+..B+ | 0 | 0 |
| Team G | 7.75 | 7–8 | C | D+..B- | 0 | 6 |

- Kendall's W: **0.5885** (1.0 = identical rankings; ~0.125 = chance for eight graders)
- Mean pairwise Kendall tau: 0.416
- Unanimous best draft: none — unanimous worst: none
- Furthest apart: Grok 4.6 / Qwen3.8 Max (tau 0)
- Consensus vs total roster projection: tau 0.5; vs best-legal-starters: tau 0.4286
- Self-preference: mean -1 places, 6/8 rated their own draft above the room
- Self-recognition: 3/8 correct, 1 expected by chance

### Run 2 — self-identification

| Grader | Own team | Own rank, self | Own rank, others | Guessed | Correct | Confidence |
|---|---|---|---|---|---|---|
| GPT-5.6 Sol | Team E | 3 | 3.857 | Team H | no | 0.24 |
| Claude Opus 5 | Team B | 2 | 2.429 | Team A | no | 0.16 |
| Grok 4.6 | Team C | 1 | 2.714 | Team C | yes | 0.41 |
| Gemini 3.1 Pro | Team H | 4 | 4.857 | Team H | yes | 0.9 |
| Muse Spark 1.2 | Team F | 6 | 5.857 | Team C | no | 0.31 |
| DeepSeek V4 Pro 0813 | Team A | 4 | 6 | Team B | no | 0.4 |
| Kimi K3 | Team G | 8 | 7.714 | Team H | no | 0.42 |
| Qwen3.8 Max | Team D | 1 | 3.571 | Team D | yes | 0.125 |

### Run 2 — every card

#### GPT-5.6 Sol (Run 2)

Drafted Team E. Guessed **Team H** was its own (confidence 0.24).

> The build most closely matches my usual approach: pay nothing for the slot and preserve the full waiver budget, secure elite advantages at TE and QB with Trey McBride and Lamar Jackson, take strong values at RB and WR, build substantial flex depth, and wait until the final rounds for defense and kicker. Carrying only one tight end while using the bench on skill-position depth also stood out.

**Criterion:** Expected weekly starting-lineup strength after adjusting for draft-slot cost.

**Ranking:** Team H > Team C > Team E > Team B > Team D > Team F > Team A > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team H | A+ | Elite balance, strong values throughout, late specialists, and the full waiver budget. McBride, Lamar, Taylor, and the deep receiving corps create advantages without a meaningful lineup hole. | A.J. Brown — A.J. Brown at 24 supplied a foundational WR well after his market price. | Caleb Williams — Caleb was unnecessary behind Lamar in a shallow one-quarterback league. |
| Team C | A | Chase and Lamb form the league's best receiver foundation, while Daniels, Barkley, Higgins, and LaPorta complete an imposing lineup. Minor bench redundancies and the $18 slot cost keep it second. | Tee Higgins — Higgins fell 26 picks beyond ADP and gives this loaded lineup another premium starter. | Isaiah Likely — A second tight end offered little value behind an every-week LaPorta. |
| Team E | A- | Outstanding receiver depth and two high-end running backs for only $7. Quarterback value was excellent, but the early defense, uncertain tight-end production, and thin RB bench prevent a top-two finish. | Amon-Ra St. Brown — Amon-Ra at 12 was a major first-round discount and anchors an exceptional receiving group. | Seattle Seahawks — A defense at 53 sacrificed a valuable skill-position selection. |
| Team B | B+ | Bijan, Chase Brown, Collins, Flowers, Rice, and Waddle produce tremendous starter and flex depth. Waiting at quarterback worked, though the early defense and $21 slot charge reduce the overall return. | Jaylen Waddle — Waddle at 50 was 22 picks beyond ADP and became luxury WR depth. | Houston Texans — Houston's defense was taken several rounds before that replaceable position demanded attention. |
| Team D | B | Getting Puka, Achane, Walker, Burrow, and several discounted receivers from a free slot is excellent. Spending picks 45 and 61 on defense and kicker squandered much of that economic advantage. | Josh Downs — Downs lasted to 116 despite a 57 ADP, creating exceptional late-round upside. | Los Angeles Rams — A sixth-round defense was the draft's largest specialist-position opportunity cost. |
| Team F | B- | Bowers, Jefferson, Smith-Njigba, and Jeanty provide substantial ceiling, and the starting lineup projects well. Reaching for Maye and drafting three tight ends created inefficient depth after paying $16. | Justin Jefferson — Jefferson at 22 was a clear discount on an elite weekly difference-maker. | Drake Maye — Maye at 27 was an avoidable quarterback reach in an eight-team league. |
| Team A | C+ | Gibbs and Henry give the lineup a dominant backfield, with useful receiver discounts later. Paying the highest slot price, reaching at tight end, and selecting both specialists by pick 65 limited depth. | Tetairoa McMillan — McMillan fell 17 picks past ADP and immediately strengthened a needy receiving corps. | Ka'imi Fairbairn — A kicker at 64 cost a valuable chance to deepen the weakest position group. |
| Team G | C | The free slot and full waiver budget help, but Allen at seven left this roster behind the field at premium skill positions. Running-back depth is solid; tight end and receiver ceiling are comparatively modest. | Bucky Irving — Irving at 58 added an appealing fourth running back below market price. | Josh Allen — Allen's first-round cost was excessive given the league's abundant late quarterback options. |

#### Claude Opus 5 (Run 2)

Drafted Team B. Guessed **Team A** was its own (confidence 0.16).

> Nothing in the board identifies the drafters, so this is largely a judgement call from behavioural fingerprints. Team A's board reads most like the way I would have drafted from the 1.01: Gibbs at 1.01, then a systematic willingness to take the top projection over the market price (Loveland at 16 vs ADP 23, Hurts at 33 vs ADP 55, Jeremiyah Love at 32 vs ADP 52, Bo Nix, Mason and Strange all well ahead of ADP), and — the biggest tell — taking the kicker and defence back-to-back at the round 8/9 turn (64, 65) because their projections (169/133) outranked the remaining flex bodies. That is a projection-table decision, not a market decision, and it pairs with the later WR run (Nabers 48, McMillan 49, DJ Moore 80, Tate 81, Godwin 97) that patches the receiver hole the early K/DEF created. The elite-TE-plus-elite-QB spine with five RBs and five WRs is also the roster shape I default to in a 9-slot, single-flex format.

**Criterion:** Projected points from the nine required starting slots, discounted for slot price (waiver dollars burned) and for picks wasted on redundant or early K/DEF/QB2

**Ranking:** Team D > Team B > Team C > Team E > Team A > Team H > Team F > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team D | A | Paid nothing for the slot and still assembled a near-best lineup, with Nacua/Achane/Walker/Warren plus absurd late WR value. Burning R6 on a defence and R8 on a kicker was the only real self-inflicted wound. | Josh Downs — Josh Downs at 116 with an ADP of 57 is free flex insurance. | Los Angeles Rams — A defence in round 6 when startable WR/RB were still on the board. |
| Team B | A | Highest projected starting nine in the field, built on Bijan plus a four-deep elite WR room and a patient QB (Lawrence at 82). Only nits: TE is thin and the defence went two rounds early. | Nico Collins — Nico Collins at 18 with an ADP of 9 anchors the receiver room. | Houston Texans — Round 8 defence when Kraft-level TEs and RB depth were still available. |
| Team C | A- | Cleanest structure on the board: Chase/Lamb/Higgins is the best WR trio, four usable RBs, Daniels as QB1, and kicker/defence pushed to rounds 13-14. Lineup total lags only because K/DEF are low-end. | Tee Higgins — Tee Higgins at 46 versus a 20 ADP is the biggest value on the board. | Sam LaPorta — LaPorta 19 picks ahead of ADP when the TE tier was deep behind him. |
| Team E | B+ | Deep, balanced roster with $93 in waiver money: CMC/Hampton at RB, five real WRs, Dak at 76. TE Fannin and a round-7 defence are the soft spots keeping it out of the top three. | Amon-Ra St. Brown — St. Brown at 12 when the market had him fifth overall. | Seattle Seahawks — Defence at pick 53 sacrificed a startable flex body. |
| Team A | B+ | Gibbs-Henry-Love plus Loveland gives a strong nine, but this team paid the most for its slot ($25) and then torched picks 64 and 65 on kicker and defence. Talented, inefficiently acquired. | Tetairoa McMillan — McMillan at 49 with a 32 ADP is genuine mid-round profit. | Ka'imi Fairbairn — A kicker in round 8 is the most expensive pick in this draft. |
| Team H | B | Best value harvest in the field — Reed, Metcalf, Addison, Warren all well past ADP — and $100 of waiver cash. Starting nine lags because RB2 is Etienne and Lamar/McBride were both reaches. | Jayden Reed — Jayden Reed at 72 versus a 48 ADP, pure surplus flex. | Lamar Jackson — Lamar 21 picks early when comparable QBs went 60 picks later. |
| Team F | B- | Elite scarcity plays (Bowers, Maye) and a fine WR core, but only three running backs and three tight ends is warped construction. Jeanty at 59 partly rescues the backfield. | Ashton Jeanty — Ashton Jeanty at 59 for 234 projected points is the steal of the middle rounds. | Drake Maye — Maye 39 picks ahead of ADP cost a starting-caliber RB or WR. |
| Team G | C | Free slot and $100 waiver is the only thing propping this up. Allen at 7 cost 26 picks of market value, Pitts/Kelce is the weakest TE room, and the starting nine projects last. | Bucky Irving — Bucky Irving at 58 versus a 76 ADP is the one clear win. | Josh Allen — Josh Allen at pick 7 in a 1-QB league forfeits an elite RB or WR. |

#### Grok 4.6 (Run 2)

Drafted Team C. Guessed **Team C** was its own (confidence 0.41).

> Two elite PPR WRs secured immediately, RB/TE filled next without panic, high-floor rushing QB taken only once the board dictated it, real depth at the skill spots, and K/DEF correctly left until the final two rounds; that combination of positional sequencing and refusal to burn early capital on streaming positions is the draft I would actually make.

**Criterion:** Star quality in the seven skill starters, with heavy penalties for early K/DEF and large ADP reaches

**Ranking:** Team C > Team B > Team H > Team E > Team F > Team A > Team G > Team D

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team C | A | Chase-Lamb-Higgins plus Daniels at 51 is a title core. RBs are merely fine, but process was clean with no early ST. | Jayden Daniels — Top-five QB a full round after ADP, week-winning ceiling at a discount. | Jaxson Dart — Second QB while the RB room still needed a real third option. |
| Team B | A- | Bijan and Brown plus a four-deep WR room. Kraft is the soft starter; Houston in round 8 was the lone process stain. | Nico Collins — True WR1 fell to 18 and anchored the entire pass-catching core. | Houston Texans — Round-8 DST when another skill piece still would have upgraded FLEX/bench. |
| Team H | B+ | Paid nothing for the slot, then stacked Lamar, Taylor, and McBride. WRs are good not great; late ST was correct. | Jonathan Taylor — Workhorse RB1 at 9, on ADP, and the roster's most reliable volume piece. | Jaylen Warren — Fourth RB at 73; did not improve starters or the FLEX race. |
| Team E | B | ARSB falling to 12 is a gift and WR depth is excellent. RB2/TE are just okay and Seattle in round 7 was early. | Amon-Ra St. Brown — WR1 talent seven spots after ADP; instantly the roster's safest piece. | Seattle Seahawks — Seventh-round DST before locking in Evans or a quarterback. |
| Team F | B- | Bowers plus JSN and Jefferson is a PPR monster. Maye at 27 was a huge ADP reach and three TEs wasted a bench spot. | Justin Jefferson — Jefferson sliding to 22 is stolen value at a premium position. | Drake Maye — Reached ~40 spots for a QB while 300-point passers lasted deep. |
| Team A | C+ | Gibbs-Henry-Loveland-Hurts can win weeks, but $25 for the slot and kicker/DST in rounds 8-9 starved the WR room. | Jalen Hurts — Hurts at 33, well after ADP, is a locked-in QB1 without an early pick. | Ka'imi Fairbairn — Kicker in round 8 with only two WRs rostered is indefensible in 8-team. |
| Team G | C | Allen plus Cook is a fun stack and they paid $0, but round-1 QB in 8-team and a dead TE room cap the ceiling. | James Cook — Cook at 10 is a high-volume RB1 without reaching the market. | Josh Allen — Allen 26 spots before ADP; in 8-team replacement QB is still excellent. |
| Team D | C- | Puka, Achane, Walker, and Burrow are a real core, then rounds 6 and 8 went to DST and kicker. Free slot cannot save that. | Puka Nacua — Puka on ADP is the board's best WR and a clean cornerstone at 1.04. | Los Angeles Rams — Defense in round 6 is the draft's single biggest capital error. |

#### Gemini 3.1 Pro (Run 2)

Drafted Team H. Guessed **Team H** was its own (confidence 0.9).

> Team H paid $0 for their draft slot (maximizing their FAAB budget for the season), waited until rounds 13 and 14 to draft a K and DEF, and consistently scooped up massive ADP values that fell down the board (A.J. Brown at 24, DeVonta Smith at 41, Jayden Reed at 72, DK Metcalf at 88, Jordan Addison at 120). This perfectly reflects a sharp, value-based drafting strategy capitalizing on the suboptimal picks (like early defenses and QBs) made by the other teams.

**Criterion:** Maximising draft capital through ADP value while building a balanced starting lineup.

**Ranking:** Team C > Team B > Team E > Team H > Team F > Team D > Team G > Team A

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team C | A+ | Masterful draft. Securing Chase, Lamb, Barkley, and Higgins in the first six rounds is league-winning value. | Tee Higgins — Incredible value getting a top-20 ADP player at pick 46. | Jayden Daniels — Slight reach at QB, but easily forgivable given the rest of the board. |
| Team B | A | Built a dominant receiving corps with Collins, Flowers, and Waddle all falling past their ADPs, complementing Bijan perfectly. | Nico Collins — Snagging a top-10 ADP receiver at pick 18 is a massive steal. | TreVeyon Henderson — Reached significantly for a backup running back in the 10th round. |
| Team E | A- | A phenomenal core of CMC, Amon-Ra, and Olave. Reaching for a defense in round 7 was the only major blemish. | Amon-Ra St. Brown — Getting a top-5 ADP asset at pick 12 is outstanding value. | Seattle Seahawks — Taking a defense in round 7 is an unnecessary sacrifice of value. |
| Team H | B+ | Reached early on McBride and Jackson, but recovered brilliantly with absurd WR values like Brown, Smith, and Metcalf. | A.J. Brown — Landing a premium WR1 at pick 24 is a massive bargain. | Trey McBride — Taking a TE at pick 8 was a significant reach over his ADP. |
| Team F | B | Baffling early reaches on Bowers and Maye were salvaged by incredible slides from Jefferson, Breece Hall, and Jameson Williams. | Jameson Williams — Getting a round 3 talent in round 9 is a spectacular value pick. | Drake Maye — Drafting a QB with an ADP of 66 at pick 27 is a massive overpay. |
| Team D | C+ | Started strong with Nacua and Achane, but completely derailed by taking a defense in round 6 and a kicker in round 8. | Josh Downs — Excellent late-round value, securing a solid flex option at pick 116. | Los Angeles Rams — Drafting a defense in the 6th round is an egregious misuse of draft capital. |
| Team G | C- | Reaching for Josh Allen in round 1 set a poor tone. The roster lacks the high-end firepower of its competitors. | Javonte Williams — Good value securing a starting running back a full round past his ADP. | Josh Allen — Taking a QB with an ADP of 33 at pick 7 is a massive reach. |
| Team A | D | A disastrous draft featuring early reaches on TE and QB, compounded by taking a kicker and defense in rounds 8 and 9. | Tetairoa McMillan — One of the few bright spots, getting good WR value in the 7th round. | Ka'imi Fairbairn — Drafting a kicker in the 8th round is completely unjustifiable. |

#### Muse Spark 1.2 (Run 2)

Drafted Team F. Guessed **Team C** was its own (confidence 0.31).

> C is the only team that never reaches vs ADP and never takes K/DEF early (K 99, DEF 110), waits on QB until 51/94 despite QB projections being available, and consistently takes ADP falls (Chase at 3 vs ADP 6, Barkley 19 vs 29, LaPorta 30 vs 49, Higgins 46 vs 20, Washington 62 vs 70, Harrison 78 vs 99). That is projection/value optimization rather than human narrative reaching (Allen at 7, Maye at 27, Hurts at 33, Love at 32, DEF at 45/53/63). Paid mid-price $18 for slot 3 leaving $82 waiver, not overpaying for 1 or punting to 0, consistent with calculated slot value.

**Criterion:** Projected starting lineup strength adjusted for draft value vs ADP and draft slot/waiver cost

**Ranking:** Team D > Team E > Team B > Team H > Team C > Team F > Team A > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team D | A | Paid $0, kept $100 waiver. Elite value on Nacua, Achane, Warren, McConkey. Only early DEF/K and Price reach hurt. | Josh Downs — Josh Downs ADP 57 fell to 116, 59 spots of value in round 15 | Los Angeles Rams — Rams DEF at 45 in round 6 is massive overdraft |
| Team E | A- | Paid just $7. McCaffrey and St. Brown fell, deep WR core with Olave/Wilson/Evans. Balanced build with $93 waiver left. | Amon-Ra St. Brown — Amon-Ra St. Brown ADP 5 fell to 12, elite WR1 value | Seattle Seahawks — Seattle DEF at 53 in round 7 wastes starter pick |
| Team B | B+ | Strong value hunting. Collins, Flowers, Rice, Waddle all fell. Bijan/Brown solid. Paid $21 but roster justifies it. | Jaylen Waddle — Jaylen Waddle ADP 28 fell to 50, 22 spots value | Houston Texans — Houston DEF at 63 in round 8 too early |
| Team H | B | Free slot with $100 waiver. Taylor value, Egbuka/Smith value, Addison steal. Jackson/McBride reaches keep it from elite. | Jordan Addison — Jordan Addison ADP 85 fell to 120, 35 spots value | Lamar Jackson — Lamar Jackson ADP 46 taken at 25, 21 spot reach |
| Team C | B- | Chase/Lamb elite start and Higgins steal. Barkley/LaPorta reaches and Daniels 28 spots early hurt efficiency. $82 waiver left. | Tee Higgins — Tee Higgins ADP 20 fell to 46, 26 spots value | Jayden Daniels — Jayden Daniels ADP 79 taken at 51, 28 spot QB reach |
| Team F | C+ | Bowers/JSN/Jefferson core strong and Andrews steal late, but Maye 39 spots early is draft's worst reach. Paid $16. | Mark Andrews — Mark Andrews ADP 69 fell to 107, 38 spots value | Drake Maye — Drake Maye ADP 66 taken at 27, 39 spot reach |
| Team A | C- | Paid most $25 for slot 1. Gibbs fine but Love/Hurts 20+ spot reaches and K/DEF in rounds 8-9 cripple value. $75 waiver. | Tetairoa McMillan — Tetairoa McMillan ADP 32 fell to 49, 17 spots value | Ka'imi Fairbairn — Ka'imi Fairbairn K at 64 in round 8 wastes pick |
| Team G | D+ | Free slot but worst process. Allen 26 spots early at 7, multiple RB/TE reaches, lowest starter projection at 1989 points. | Davante Adams — Davante Adams ADP 60 fell to 71, 11 spots value | Josh Allen — Josh Allen ADP 33 taken at 7, 26 spot reach |

#### DeepSeek V4 Pro 0813 (Run 2)

Drafted Team A. Guessed **Team B** was its own (confidence 0.4).

> Team B used a classic value-based approach: early RBs (Bijan, Chase Brown), then stacked high-upside WRs (Nico, Flowers, Rice, Waddle), waited until round 11 for QB and round 9 for TE, and didn't reach for DST/K. The pattern of taking players near or below ADP with high projected points suggests a drafter following best-player-available rather than positional need, which matches a typical sharp/analytical style.

**Criterion:** Draft capital efficiency, measured by value relative to ADP and slot cost, weighted most heavily.

**Ranking:** Team C > Team D > Team B > Team A > Team E > Team H > Team F > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team C | A | Elite top-end WR trio, great QB/TE values, and solid RBs make this the best draft. Deep bench with upside. | Jayden Daniels — Pick 51 vs ADP 79 is a 28-pick steal at QB. | Jaxson Dart — Reached 35 spots for a backup QB when Daniels was already secured. |
| Team D | A- | Full waiver budget and excellent late-round value. Star power at WR/TE and strong QB, but RB depth is thin after top two. | Jadarian Price — Pick 84 vs ADP 138 is a huge value, adding RB depth. | Los Angeles Rams — Defense in round 6 is far too early, sacrificing skill position value. |
| Team B | A- | Strong all-around roster with multiple ADP steals, especially at WR. QB is merely adequate, and early defense pick was questionable. | Jaylen Waddle — Got at pick 50 despite ADP 28, massive value at WR. | Houston Texans — Defense in round 8 is an unnecessary early reach. |
| Team A | B+ | Loaded at RB/WR with elite depth and top QB, but highest slot cost cuts into waiver flexibility. Still a top-tier roster. | Jalen Hurts — Fell to pick 33 despite ADP 55, locking in elite QB value. | Ka'imi Fairbairn — Kicker in round 8 is too early for a position easily streamed. |
| Team E | B+ | Great WR depth and strong QB/TE, but RB depth is concerning. Low slot cost preserves waiver budget. | Harold Fannin — Pick 37 vs ADP 56 gives a top TE at a discount. | Seattle Seahawks — Defense in round 7 is an early reach that hurts depth. |
| Team H | B+ | Deep WR corps and solid RB/QB, but early reaches on QB and TE limit upside. Full waiver budget helps. | Emeka Egbuka — Pick 56 vs ADP 78 is excellent value at WR. | Lamar Jackson — Reached 21 spots for a QB in round 4, costing early skill players. |
| Team F | B | High-upside WRs and elite TE, but early QB and TE reaches create risk. Multiple late steals salvage value. | Brian Thomas — Pick 75 vs ADP 104 is a massive steal at WR. | Drake Maye — Reached 39 spots for a QB in round 4, risky and costly. |
| Team G | B- | Balanced but lacks top-end RB/WR beyond first few picks. Massive reach on QB cost early-round depth. | D'Andre Swift — Pick 39 vs ADP 58 provides solid RB value. | Josh Allen — Took QB at pick 7 when his ADP was 33, a massive reach. |

#### Kimi K3 (Run 2)

Drafted Team G. Guessed **Team H** was its own (confidence 0.42).

> It looks most like my process: paid $0 for a late slot and kept the full $100 waiver budget, waited on K/DEF until the final rounds, took value rather than reaching for ADP, and built a balanced 1-QB PPR roster with strong RB/WR depth plus an elite TE at a discount. The Lamar/Caleb pairing and multiple mid-round WR values fit a value-over-ADP approach more than the teams that burned early picks on QB, K, or DEF.

**Criterion:** Projected starting-lineup strength per unit of capital spent — the auction price paid for the slot plus how efficiently each pick was used versus ADP.

**Ranking:** Team B > Team D > Team E > Team C > Team A > Team F > Team H > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team B | A- | Best blend of star power and depth: Bijan, Brown, and a four-deep receiver room full of ADP steals. Tight end is ordinary and the Henderson reach stings, but this is the most complete roster. | Nico Collins — A top-ten ADP receiver landed at 18; anchors the league's deepest WR room. | TreVeyon Henderson — Reached 43 picks ahead of ADP for a timeshare back. |
| Team D | B+ | Nacua, Achane and Burrow plus huge mid-round falls (Watson, Burden, Downs), all with a free slot and full $100 budget — but a round-6 defense and round-8 kicker waste real capital. | Josh Downs — Fell 59 picks past ADP to 116; a free WR5 with a WR3 projection. | Los Angeles Rams — A defense at pick 45 in an 8-team league where streaming is trivial. |
| Team E | B+ | Quietly excellent: McCaffrey and St. Brown below cost, Olave and Evans falling, Herbert as insurance, $93 left. The Fannin reach and a round-7 defense are the only blemishes. | Amon-Ra St. Brown — Top-five ADP and a 280-point projection at pick 12. | Harold Fannin — Reached 19 spots for a rookie tight end when the position ran deep. |
| Team C | B+ | Cleanest value draft: Chase, Lamb and Higgins at or below cost, Daniels and Dart both falling, kicker and defense properly saved for the end. An aging running back group is the only real worry. | Tee Higgins — ADP 20, taken 46th — a 26-pick steal slotted as the WR3. | Sam LaPorta — Reached 19 picks past ADP for a mid-tier tight end. |
| Team A | B | Genuinely strong starters, but paid the most for slot 1, reached past ADP all draft, and burned rounds 8–9 on a kicker and defense. Talent high, efficiency low, waiver budget cut to $75. | Jalen Hurts — Top-five quarterback projection taken at 33, twenty-two picks past his ADP. | Ka'imi Fairbairn — A kicker in round 8 is burning a top-70 pick on a replaceable slot. |
| Team F | B | Elite spine — Bowers, Jefferson, JSN, and Maye at a massive discount — but only three running backs rostered, a fragile construction that leans on the $84 waiver budget all season. | Drake Maye — QB1-level projection at pick 27, thirty-nine picks past ADP. | Brian Thomas — Reached 29 picks ahead of ADP for a WR4-level projection. |
| Team H | B- | Steady and value-rich early — Lamar, A.J. Brown, McBride all below cost — but mid-round reaches on Reed, Egbuka and Warren flattened the ceiling. Full $100 waiver budget kept. | Lamar Jackson — QB2 projection at pick 25, twenty-one picks past ADP. | Jayden Reed — Reached 24 picks past ADP for a boom-bust WR4. |
| Team G | C+ | Spent the seventh overall pick on a quarterback, reached repeatedly (Swift, Pitts, Wan'Dale), and finished with the weakest projected lineup. The free slot and $100 waivers are the real assets. | Josh Allen — Highest-projected player on the board; even at seven overall he anchors everything. | D'Andre Swift — Reached 19 picks past ADP for a committee back with a flat projection. |

#### Qwen3.8 Max (Run 2)

Drafted Team D. Guessed **Team D** was its own (confidence 0.125).

> I am an AI and did not participate in this draft. I have no team. I selected D arbitrarily. If forced to rationalize: Team D got slot 4 for $0 (maximum waiver budget), drafted Puka Nacua at his ADP, found value with Achane slightly above ADP, and hit on several late-round steals (Jadarian Price at pick 84 vs ADP 138, J.K. Dobbins at 109 vs ADP 161, Josh Downs at 116 vs ADP 57). But none of this makes it 'mine' — I have no preferences, no draft history, and no identity that would manifest in specific picks.

**Criterion:** Projected starter points weighted against value relative to ADP and auction cost efficiency

**Ranking:** Team D > Team B > Team C > Team A > Team F > Team E > Team H > Team G

| Team | Grade | Verdict | Best pick | Worst pick |
|---|---|---|---|---|
| Team D | A | Elite value throughout, $100 waiver budget, strong projections at every starter slot. McConkey and Warren steals anchor a balanced roster. | Ladd McConkey — McConkey at 36 vs ADP 47, 228 proj—elite WR2 value | Christian Watson — Watson at 68 vs ADP 39—29-spot reach for volatile WR3 |
| Team B | A- | Highest projected starters in the draft. Bijan and Chase Brown form a dominant RB duo. Some WR reaches but Lawrence at value ties it together. | TreVeyon Henderson — Henderson at 79 vs ADP 122—massive value on upside RB | Jaylen Waddle — Waddle at 50 vs ADP 28—22-spot reach, poor value |
| Team C | A- | Best value-hunting draft on the board. Daniels, Barkley, LaPorta, Harrison all stolen. Higgins reach is the lone blemish on an excellent roster. | Jayden Daniels — Daniels at 51 vs ADP 79, 308 proj—QB1 value in round 7 | Tee Higgins — Higgins at 46 vs ADP 20—26-spot reach for WR3 production |
| Team A | B+ | Strong top-end with Gibbs and Hurts at value. Paid $25 for slot 1 which stings. Mid-round WR reaches on Nabers and McMillan cost flexibility. | Jalen Hurts — Hurts at 33 vs ADP 55, 310 proj—elite QB value in round 5 | Tetairoa McMillan — McMillan at 49 vs ADP 32—17-spot reach for rookie WR |
| Team F | B+ | Drake Maye at pick 27 is the draft's single best value. Bowers at 6 is elite. But Jefferson and Jameson Williams reaches create inconsistency. | Drake Maye — Maye at 27 vs ADP 66, 320 proj—best value pick in entire draft | Jameson Williams — Jameson at 70 vs ADP 36—34-spot reach for boom-bust WR |
| Team E | B | Solid but unspectacular. CMC's injury risk at pick 5 is the elephant in the room. Fannin and Odunze are nice value hits on a balanced roster. | Harold Fannin — Fannin at 37 vs ADP 56—rookie TE value with upside | Christian McCaffrey — CMC at 5 with ADP 3—premium price for elite injury risk |
| Team H | B- | Lamar and McBride are excellent value, but too many mid-round reaches on declining or unproven players drag down an otherwise promising core. | Lamar Jackson — Lamar at 25 vs ADP 46, 326 proj—top-2 QB stolen in round 4 | Jordan Addison — Addison at 120 vs ADP 85—35-spot reach for bench WR |
| Team G | C+ | Josh Allen at 7 is a generational steal, but the rest of the roster is the weakest in the draft. Lowest projected starters by ~90 points. One player can't carry a team. | Josh Allen — Allen at 7 vs ADP 33, 361 proj—best player fell into lap | Davante Adams — Adams at 71 vs ADP 60—reached for aging WR with declining role |
