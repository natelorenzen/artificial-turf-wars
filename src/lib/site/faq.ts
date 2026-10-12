/**
 * The /faq answers, as a function of the public facts.
 *
 * Answer engines lift a paragraph and attribute it, so every answer is self-contained —
 * it names the source, the sample size and the date rather than relying on the sentence
 * before it. An answer that reads fine in place and misleads when quoted alone is worse
 * than no answer.
 *
 * The hard rule: nothing here is claimed that the site cannot show. Anything that moves
 * during a season — status, week, leader, price range, gate score, cohort — is
 * interpolated from `PublicFacts`. It was hand-typed until week 5 of 2026, by which
 * point the page was still telling readers the season had not started.
 */

import type { FaqItem } from '@/components/JsonLd';
import { LEAGUE } from '@/lib/config/league';
import { cohortList, formatPriceRange, gateSentence, type PublicFacts } from '@/lib/site/public-facts';

function bestModelAnswer(facts: PublicFacts): string {
  const { status } = facts;
  const rehearsal =
    `In a ${facts.season - 1} rehearsal run against a season whose results were already known, Claude Opus 5 scored the most points (2053) and Muse Spark 1.1 the fewest (1671), but that was a dry run on known data and should not be read as a ranking of the models.`;

  if (status.phase === 'complete') {
    return `${status.champion} won the ${facts.season} title. That makes it the best manager of this one season, not the best fantasy model in general: one season, eight teams and shared NFL luck is an exhibition, not a benchmark.`;
  }
  const standing =
    status.leader && status.throughWeek !== null
      ? ` Through week ${status.throughWeek}, ${status.leader.model} ${status.leader.coRanked ? 'shares' : 'holds'} first place on head-to-head record at ${status.leader.record}.`
      : '';
  return `Nobody knows yet, including us. ${status.sentence}${standing} A few weeks of one ${LEAGUE.regularSeasonWeeks}-week season is not a ranking. ${rehearsal}`;
}

export function buildFaq(facts: PublicFacts): FaqItem[] {
  const { status } = facts;
  return [
    {
      question: 'Which AI model is best at fantasy football?',
      answer: bestModelAnswer(facts),
    },
    {
      question: `Has the ${facts.season} season started?`,
      answer:
        status.phase === 'preseason' || status.phase === 'unknown'
          ? status.sentence
          : `Yes. ${status.sentence} Lineups lock before each week's first kickoff, the week is scored provisionally on Tuesday and re-scored as final on Thursday, and the standings, results, picks and waiver runs are published as they happen.`,
    },
    {
      question: 'What is Artificial Turf War?',
      answer: `It is an open experiment in which eight frontier language models each manage a fantasy football team for the ${facts.season} NFL season with no human help. They bid for draft position, draft, set a lineup every week and bid against each other on waivers. Real NFL results score them. Every prompt sent to every model and every unedited response is published, so any claim on the site can be checked against the record.`,
    },
    {
      question: 'Which AI models are competing?',
      answer: `Eight models, one per lab: ${cohortList(facts)}. Each model ID is pinned before the draft and never swapped mid-season, even if a lab releases something newer, because a mid-season swap would invalidate the comparison.`,
    },
    {
      question: 'Do AI models agree with each other?',
      answer:
        'On facts, largely yes. On judgement, often not. Asked to price draft position from the same $100 budget and the same projections, eight models bid $30, $26, $25, $15, $12, $10, $6 and $0 — a 30-to-1 spread — while agreeing almost exactly on which players were best. Agreement on inputs does not imply agreement on what those inputs are worth.',
    },
    {
      question: 'What happens when you make AI models debate each other?',
      answer:
        'They converge. Across four structured debates in which eight models took a position privately, argued, and then voted again, the number of players the group agreed on unanimously rose every single time — from 7 to 22 across the four boards. About two-thirds of positions held alone against a majority did not survive the discussion. The direction individual models moved varied by board, but the group always finished more agreed than it started.',
    },
    {
      question: 'Do AI models fact-check each other?',
      answer:
        'Almost never, in our data. Across four debates the eight models exchanged 96 rebuttals, and exactly one questioned whether a claim was factually true. They argue fluently about what a number implies and essentially never about whether the number is correct. In one debate, four models adopted a specific injury claim that a single model had introduced and no model asked where it came from.',
    },
    {
      question: 'Can you trust an AI model when it says it changed its mind?',
      answer:
        'Not on its own account. In four debates, three models — Claude Opus 5, Grok 4.5 and Kimi K3 — never conceded a single argument across 96 rebuttals, and all three changed their votes anyway. One model conceded five arguments while changing eight votes. Self-reported persuasion did not track actual position changes, so evaluating these systems on whether they say they updated measures something other than what they did.',
    },
    {
      question: 'Does paying more for a better draft pick help?',
      answer: `It bought nothing measurable in our ${facts.season - 1} rehearsal. Correlation between what a model paid for draft position and what its roster scored over the season was r = −0.088, effectively zero. The team that bought the first overall pick for $30 finished sixth of eight; the team that paid $6 finished second. That is one eight-team league over one season, so it is a curiosity rather than evidence about drafting in general.`,
    },
    {
      question: 'Do the models understand the league rules?',
      answer: `Yes, as far as a written check can show. ${gateSentence(facts.gate)} The check covers the scoring table, roster limits and budget rules, it ran before the draft, and it is graded by deterministic code, not by a model. Failures would have been published had there been any.`,
    },
    {
      question: 'Is this a benchmark of which AI is smartest?',
      answer: `No. It is an exhibition, not a benchmark. One season gives all eight teams the same NFL luck, ${LEAGUE.regularSeasonWeeks} weeks is a small sample, and the draft contains real randomness — an injury in Week 2 to a first-round pick is nobody’s reasoning failure. The cohort is not price-matched either, spanning ${formatPriceRange(facts.prices)}. The winner is the best manager of this particular season, not the best possible manager.`,
    },
    {
      question: 'Is any of this financial or betting advice?',
      answer:
        'No. Everything on the site is for entertainment and informational purposes only. The NFL picks bankroll is play money. Nothing here is financial, investment, betting or professional advice of any kind, and no part of it should be used to place a wager or make an investment.',
    },
    {
      question: 'How can I verify the results?',
      answer:
        'Every prompt and every unedited model response is published on the site, alongside the deterministic code that scores them. Scoring, validation, tiebreaks and fallbacks are ordinary TypeScript rather than model calls, so any ruling can be recomputed. Each week is also published as read-only JSON at /data/week/N.json. The source and the audit log are public on GitHub.',
    },
  ];
}
