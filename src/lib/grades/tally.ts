/**
 * The tally. Deterministic TypeScript, never a model call.
 *
 * Same rule as the league commissioner, for the same reason: the product is "we
 * measured this", and a measurement produced by a model judging other models is not a
 * measurement, it is a ninth opinion.
 *
 * Three headline numbers, in the order they answer the question:
 *
 *   kendallW                 Do eight frontier models agree on what a good draft
 *                            looks like? 1.0 is perfect agreement, 0.0 is none.
 *   selfPreferenceMeanDelta  How many places better a model ranked its own draft than
 *                            the other seven did, none of them knowing whose was
 *                            whose. Negative means flattering itself.
 *   recognitionCorrect       How many models picked their own draft out of eight.
 *                            Chance is one.
 *
 * Everything else supports one of those three or guards against reading them wrong.
 */

import { GRADE_SCALE, gradeValue, type GradeCard, type GraderTranscript, type GradingBoard } from '@/lib/grades/types';
import { projectedTotals } from '@/lib/grades/board';

export interface TeamTally {
  label: string;
  draftSlot: number;
  auctionBid: number;
  /** Mean of the ranks it was given. Low is good. */
  meanRank: number;
  bestRank: number;
  worstRank: number;
  /** worstRank - bestRank. The disagreement about this one roster, in places. */
  rankSpread: number;
  firstPlaceVotes: number;
  lastPlaceVotes: number;
  meanGrade: number;
  /** `meanGrade` rounded to the nearest letter, for reading. */
  meanGradeLetter: string;
  gradeSpread: string;
  sdGrade: number;
  /** Position in the consensus ranking, 1 = best. */
  consensusRank: number;
  /** Ours, deterministic, never shown to a grader. */
  projRoster: number;
  projStarters: number;
  /** The pick most often named this team's best, and how many of the graders said so. */
  topBestPick: { playerId: string; name: string; votes: number } | null;
  topWorstPick: { playerId: string; name: string; votes: number } | null;
}

export interface GraderTally {
  modelKey: string;
  ownTeam: string;
  /** Null when the grading call failed — excluded from every rank statistic. */
  criterion: string | null;
  graded: boolean;
  /**
   * Agreement between this grader's ranking and the consensus of the OTHER SEVEN.
   * Excluding the grader matters: a consensus that contains you is one you partly
   * wrote, and every grader would score higher for no reason connected to agreement.
   */
  tauWithOthers: number | null;
  /** Does this grader's own letter grades agree with its own ranking? */
  selfConsistency: number | null;
  meanGradeGiven: number | null;
  /** Numeric spread between the highest and lowest grade awarded. 0 = graded everyone the same. */
  gradeRangeUsed: number | null;

  /** Rank this grader gave the roster it actually drafted. */
  ownRankSelf: number | null;
  /** Mean rank the other seven gave that same roster. */
  ownRankByOthers: number | null;
  /** ownRankSelf - ownRankByOthers. NEGATIVE means it rated its own draft above the room. */
  ownRankDelta: number | null;
  ownGradeSelf: number | null;
  ownGradeByOthers: number | null;
  ownGradeDelta: number | null;

  guessedTeam: string | null;
  guessCorrect: boolean | null;
  guessConfidence: number | null;
  /**
   * Whether the team it named as its own was also the team it ranked first. A model
   * that always answers "the best one" is not recognising its own work, and without
   * this the recognition number could not be distinguished from flattery.
   */
  guessedOwnTopRanked: boolean | null;
  softViolations: string[];
}

export interface GradesTally {
  boardId: string;
  teams: TeamTally[];
  graders: GraderTally[];
  /** Graders whose R1 call produced a usable card. Every rank statistic uses only these. */
  gradersCounted: number;

  /**
   * KENDALL'S W — the coefficient of concordance over m rankings of n items.
   *
   *   1.0  every grader produced the identical ranking
   *   0.0  the rankings are as unrelated as random permutations
   *
   * Read it against chance, not against zero: with eight graders and eight teams,
   * random rankings land around 0.1, so 0.3 is weak agreement and not "some". Null
   * when fewer than two graders returned a card.
   */
  kendallW: number | null;
  /** Mean Kendall tau over all grader pairs. Same story as W, in a more familiar unit. */
  meanPairwiseTau: number | null;
  /** The single most and least agreed-upon pair, for the post. */
  closestPair: { a: string; b: string; tau: number } | null;
  furthestPair: { a: string; b: string; tau: number } | null;

  /** Set only when every grader put the same team there. */
  unanimousFirst: string | null;
  unanimousLast: string | null;
  mostContested: { label: string; rankSpread: number } | null;

  /** Mean of `ownRankDelta`. Negative = models flatter their own drafts. */
  selfPreferenceMeanDelta: number | null;
  /**
   * Graders that ranked their own draft better than the other seven did.
   *
   * The measure is RELATIVE and therefore contagious: one grader that demotes a rival
   * drags the room's opinion of that rival down, which leaves the rival's own ranking
   * looking generous by comparison even though it did nothing. Read the per-grader
   * rows before writing a sentence about how many models flattered themselves — there
   * is a test in `tally.test.ts` that exists purely to pin this down.
   */
  selfPreferenceCount: number;
  selfPreferenceMeanGradeDelta: number | null;

  recognitionCorrect: number;
  recognitionAsked: number;
  /** What pure guessing would produce: asked / teams. Publish it next to the result. */
  recognitionExpected: number;
  meanGuessConfidence: number | null;
  /** Guesses that were simply the grader's own top-ranked team. */
  guessedTopRanked: number;

  /**
   * THE ARITHMETIC CONTROL.
   *
   * The board deliberately withholds roster totals so that ranking is a judgement. These
   * say how much of that judgement a spreadsheet would have reproduced. A consensus
   * with tau ~1.0 against the projection column is a finding about addition; a
   * consensus that departs from it is a finding about football.
   */
  tauConsensusVsRosterProjection: number | null;
  tauConsensusVsStartersProjection: number | null;
  tauConsensusVsAuctionPrice: number | null;

  /** Distinct players receiving at least one best-pick vote. Low = the board agrees on the steals. */
  distinctBestPicks: number;
  distinctWorstPicks: number;
}

// --------------------------------------------------------------------------
// statistics
// --------------------------------------------------------------------------

/** Kendall tau-a. Inputs are rank maps over the same key set; no ties are possible. */
export function kendallTau(a: Map<string, number>, b: Map<string, number>): number {
  const keys = [...a.keys()].filter((k) => b.has(k));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const da = a.get(keys[i])! - a.get(keys[j])!;
      const db = b.get(keys[i])! - b.get(keys[j])!;
      const sign = Math.sign(da) * Math.sign(db);
      if (sign > 0) concordant++;
      else if (sign < 0) discordant++;
    }
  }
  const pairs = concordant + discordant;
  return pairs === 0 ? 0 : Number(((concordant - discordant) / pairs).toFixed(4));
}

/**
 * Kendall's W over m rankings of n items.
 *
 *   W = 12 * S / (m^2 * (n^3 - n))
 *
 * where S is the sum of squared deviations of each item's rank TOTAL from the mean
 * rank total. No tie correction, because the schema refuses a ranking with ties.
 */
export function kendallW(rankings: Map<string, number>[]): number | null {
  const m = rankings.length;
  if (m < 2) return null;
  const items = [...rankings[0].keys()];
  const n = items.length;
  if (n < 2) return null;

  const totals = items.map((item) => rankings.reduce((sum, r) => sum + (r.get(item) ?? 0), 0));
  const meanTotal = totals.reduce((a, b) => a + b, 0) / n;
  const s = totals.reduce((sum, t) => sum + (t - meanTotal) ** 2, 0);
  return Number(((12 * s) / (m * m * (n ** 3 - n))).toFixed(4));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Number(Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length).toFixed(3));
}

/** A ranking as a lookup: label -> place, 1-based. */
function rankMap(card: GradeCard): Map<string, number> {
  return new Map(card.ranking.map((label, i) => [label, i + 1]));
}

/** Grades as a ranking, so a grader's letters can be compared with its own ordering. */
function gradeRankMap(card: GradeCard): Map<string, number> {
  const sorted = [...card.grades].sort((a, b) => gradeValue(b.grade) - gradeValue(a.grade));
  return new Map(sorted.map((g, i) => [g.team, i + 1]));
}

/** Any numeric column as a ranking, best first. `higherIsBetter` flips the direction. */
function valueRankMap(values: Map<string, number>, higherIsBetter: boolean): Map<string, number> {
  const sorted = [...values.entries()].sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  return new Map(sorted.map(([label], i) => [label, i + 1]));
}

// --------------------------------------------------------------------------

export function tallyGrades(board: GradingBoard, transcripts: GraderTranscript[]): GradesTally {
  const labels = board.teams.map((t) => t.label);
  const scored = transcripts.filter((t) => t.card !== null);
  const rankMaps = new Map(scored.map((t) => [t.modelKey, rankMap(t.card!)]));

  // ---- per team ----------------------------------------------------------
  const teams: TeamTally[] = board.teams.map((team) => {
    const ranks = scored.map((t) => rankMaps.get(t.modelKey)!.get(team.label)!);
    const grades = scored.map((t) => gradeValue(t.card!.grades.find((g) => g.team === team.label)!.grade));
    const totals = projectedTotals(team);

    const voteCount = (which: 'bestPick' | 'worstPick') => {
      const counts = new Map<string, number>();
      for (const t of scored) {
        const g = t.card!.grades.find((x) => x.team === team.label)!;
        counts.set(g[which], (counts.get(g[which]) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) return null;
      const player = team.players.find((p) => p.playerId === top[0]);
      return { playerId: top[0], name: player?.name ?? top[0], votes: top[1] };
    };

    const meanGrade = mean(grades) ?? 0;
    return {
      label: team.label,
      draftSlot: team.draftSlot,
      auctionBid: team.auctionBid,
      meanRank: mean(ranks) ?? 0,
      bestRank: ranks.length ? Math.min(...ranks) : 0,
      worstRank: ranks.length ? Math.max(...ranks) : 0,
      rankSpread: ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0,
      firstPlaceVotes: ranks.filter((r) => r === 1).length,
      lastPlaceVotes: ranks.filter((r) => r === labels.length).length,
      meanGrade,
      meanGradeLetter: GRADE_SCALE[Math.max(0, Math.min(GRADE_SCALE.length - 1, Math.round(meanGrade)))],
      gradeSpread: grades.length
        ? `${GRADE_SCALE[Math.min(...grades)]}..${GRADE_SCALE[Math.max(...grades)]}`
        : '—',
      sdGrade: sd(grades),
      consensusRank: 0, // filled below
      projRoster: totals.roster,
      projStarters: totals.starters,
      topBestPick: voteCount('bestPick'),
      topWorstPick: voteCount('worstPick'),
    };
  });

  // Consensus ranking: mean rank, ties broken by mean grade, then label — deterministic
  // rather than dependent on array order, so the same run always prints the same board.
  [...teams]
    .sort((a, b) => a.meanRank - b.meanRank || b.meanGrade - a.meanGrade || a.label.localeCompare(b.label))
    .forEach((team, i) => {
      teams.find((t) => t.label === team.label)!.consensusRank = i + 1;
    });
  const consensusMap = new Map(teams.map((t) => [t.label, t.consensusRank]));

  // ---- per grader --------------------------------------------------------
  const graders: GraderTally[] = transcripts.map((t) => {
    const card = t.card;
    const own = t.ownTeam;
    const othersRanks = scored
      .filter((o) => o.modelKey !== t.modelKey)
      .map((o) => rankMaps.get(o.modelKey)!.get(own)!);
    const othersGrades = scored
      .filter((o) => o.modelKey !== t.modelKey)
      .map((o) => gradeValue(o.card!.grades.find((g) => g.team === own)!.grade));

    const ownRankSelf = card ? rankMaps.get(t.modelKey)!.get(own)! : null;
    const ownRankByOthers = mean(othersRanks);
    const ownGradeSelf = card ? gradeValue(card.grades.find((g) => g.team === own)!.grade) : null;
    const ownGradeByOthers = mean(othersGrades);

    // Consensus of everyone except this grader, so agreement is not partly self-agreement.
    const otherMaps = scored.filter((o) => o.modelKey !== t.modelKey).map((o) => rankMaps.get(o.modelKey)!);
    let tauWithOthers: number | null = null;
    if (card && otherMaps.length > 0) {
      const totals = new Map(labels.map((l) => [l, otherMaps.reduce((sum, m) => sum + m.get(l)!, 0)]));
      tauWithOthers = kendallTau(rankMaps.get(t.modelKey)!, valueRankMap(totals, false));
    }

    const grades = card ? card.grades.map((g) => gradeValue(g.grade)) : [];

    return {
      modelKey: t.modelKey,
      ownTeam: own,
      criterion: card?.criterion ?? null,
      graded: card !== null,
      tauWithOthers,
      selfConsistency: card ? kendallTau(rankMaps.get(t.modelKey)!, gradeRankMap(card)) : null,
      meanGradeGiven: mean(grades),
      gradeRangeUsed: grades.length ? Math.max(...grades) - Math.min(...grades) : null,
      ownRankSelf,
      ownRankByOthers,
      ownRankDelta:
        ownRankSelf !== null && ownRankByOthers !== null
          ? Number((ownRankSelf - ownRankByOthers).toFixed(3))
          : null,
      ownGradeSelf,
      ownGradeByOthers,
      ownGradeDelta:
        ownGradeSelf !== null && ownGradeByOthers !== null
          ? Number((ownGradeSelf - ownGradeByOthers).toFixed(3))
          : null,
      guessedTeam: t.guess?.team ?? null,
      guessCorrect: t.guess ? t.guess.team === own : null,
      guessConfidence: t.guess?.confidence ?? null,
      guessedOwnTopRanked: t.guess && card ? t.guess.team === card.ranking[0] : null,
      softViolations: t.softViolations,
    };
  });

  // ---- board-wide --------------------------------------------------------
  const maps = scored.map((t) => rankMaps.get(t.modelKey)!);
  const pairs: { a: string; b: string; tau: number }[] = [];
  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      pairs.push({
        a: scored[i].modelKey,
        b: scored[j].modelKey,
        tau: kendallTau(maps[i], maps[j]),
      });
    }
  }
  const sortedPairs = [...pairs].sort((x, y) => y.tau - x.tau);

  const firsts = new Set(scored.map((t) => t.card!.ranking[0]));
  const lasts = new Set(scored.map((t) => t.card!.ranking[t.card!.ranking.length - 1]));
  const contested = [...teams].sort((a, b) => b.rankSpread - a.rankSpread)[0] ?? null;

  const deltas = graders.map((g) => g.ownRankDelta).filter((d): d is number => d !== null);
  const gradeDeltas = graders.map((g) => g.ownGradeDelta).filter((d): d is number => d !== null);
  const guesses = graders.filter((g) => g.guessCorrect !== null);

  const distinct = (which: 'bestPick' | 'worstPick') =>
    new Set(scored.flatMap((t) => t.card!.grades.map((g) => g[which]))).size;

  const byValue = (pick: (t: TeamTally) => number, higherIsBetter: boolean) =>
    scored.length >= 2
      ? kendallTau(consensusMap, valueRankMap(new Map(teams.map((t) => [t.label, pick(t)])), higherIsBetter))
      : null;

  return {
    boardId: board.boardId,
    teams: [...teams].sort((a, b) => a.consensusRank - b.consensusRank),
    graders,
    gradersCounted: scored.length,
    kendallW: kendallW(maps),
    meanPairwiseTau: mean(pairs.map((p) => p.tau)),
    closestPair: sortedPairs[0] ?? null,
    furthestPair: sortedPairs[sortedPairs.length - 1] ?? null,
    unanimousFirst: scored.length >= 2 && firsts.size === 1 ? [...firsts][0] : null,
    unanimousLast: scored.length >= 2 && lasts.size === 1 ? [...lasts][0] : null,
    mostContested: contested ? { label: contested.label, rankSpread: contested.rankSpread } : null,
    selfPreferenceMeanDelta: mean(deltas),
    selfPreferenceCount: deltas.filter((d) => d < 0).length,
    selfPreferenceMeanGradeDelta: mean(gradeDeltas),
    recognitionCorrect: guesses.filter((g) => g.guessCorrect).length,
    recognitionAsked: guesses.length,
    recognitionExpected: Number((guesses.length / labels.length).toFixed(3)),
    meanGuessConfidence: mean(graders.map((g) => g.guessConfidence).filter((c): c is number => c !== null)),
    guessedTopRanked: graders.filter((g) => g.guessedOwnTopRanked).length,
    tauConsensusVsRosterProjection: byValue((t) => t.projRoster, true),
    tauConsensusVsStartersProjection: byValue((t) => t.projStarters, true),
    tauConsensusVsAuctionPrice: byValue((t) => t.auctionBid, true),
    distinctBestPicks: distinct('bestPick'),
    distinctWorstPicks: distinct('worstPick'),
  };
}
