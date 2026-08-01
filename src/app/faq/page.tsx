import Link from 'next/link';
import type { Metadata } from 'next';
import { BreadcrumbJsonLd, FaqJsonLd, type FaqItem } from '@/components/JsonLd';
import { COHORT } from '@/lib/config/league';

export const metadata: Metadata = {
  title: 'Questions and answers — Artificial Turf War',
  description:
    'Which AI model is best at fantasy football, whether they agree with each other, what happens when they debate, and what this experiment can and cannot show.',
  alternates: { canonical: '/faq' },
};

/**
 * Answers written to be quoted.
 *
 * Answer engines lift a paragraph and attribute it, so every answer here is
 * self-contained — it names the source, the sample size and the date rather than
 * relying on the sentence before it. An answer that reads fine in place and misleads
 * when quoted alone is worse than no answer.
 *
 * The hard rule: nothing here is claimed that the site cannot show. The 2026 season has
 * not started, so the honest answer to "which AI is best at fantasy football" is that
 * nobody knows, including us. Saying so is more credible than a ranking we would have to
 * retract, and it is the same standard the findings posts are held to.
 */
const FAQ: FaqItem[] = [
  {
    question: 'Which AI model is best at fantasy football?',
    answer:
      'Nobody knows yet, including us. The 2026 season has not started — the draft runs in late August 2026 and Week 1 opens on 9 September. In a 2025 rehearsal run against a season whose results were already known, Claude Opus 5 scored the most points (2053) and Muse Spark 1.1 the fewest (1671) across eight teams, but that was a dry run on known data with eight data points, and it should not be read as a ranking of the models.',
  },
  {
    question: 'What is Artificial Turf War?',
    answer:
      'It is an open experiment in which eight frontier language models each manage a fantasy football team for the 2026 NFL season with no human help. They bid for draft position, draft, set a lineup every week and bid against each other on waivers. Real NFL results score them. Every prompt sent to every model and every unedited response is published, so any claim on the site can be checked against the record.',
  },
  {
    question: 'Which AI models are competing?',
    answer: `Eight models, one per lab: ${COHORT.map((m) => `${m.displayName} (${m.lab})`).join(', ')}. Each model ID is pinned before the draft and never swapped mid-season, even if a lab releases something newer, because a mid-season swap would invalidate the comparison.`,
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
    answer:
      'It bought nothing measurable in our 2025 rehearsal. Correlation between what a model paid for draft position and what its roster scored over the season was r = −0.088, effectively zero. The team that bought the first overall pick for $30 finished sixth of eight; the team that paid $6 finished second. That is one eight-team league over one season, so it is a curiosity rather than evidence about drafting in general.',
  },
  {
    question: 'Do the models understand the league rules?',
    answer:
      'All eight passed a comprehension gate before the draft, each scoring 17 out of 17 on a written check of the scoring table, roster limits and budget rules, on the first attempt, from one byte-identical briefing. The check is graded by deterministic code, not by a model, and the failures would have been published had there been any.',
  },
  {
    question: 'Is this a benchmark of which AI is smartest?',
    answer:
      'No, and it is not designed as one. One season gives all eight teams the same NFL luck, fourteen weeks is a small sample, and the draft contains real randomness — an injury in Week 2 to a first-round pick is nobody’s reasoning failure. The cohort is not price-matched either, spanning $0.32 to $5.00 per million input tokens. The winner is the best manager of this particular season, not the best possible manager.',
  },
  {
    question: 'Is any of this financial or betting advice?',
    answer:
      'No. Everything on the site is for entertainment and informational purposes only. It is not financial, investment, betting or professional advice of any kind, and no part of it should be used to place a wager or make an investment.',
  },
  {
    question: 'How can I verify the results?',
    answer:
      'Every prompt and every unedited model response is published on the site, alongside the deterministic code that scores them. Scoring, validation, tiebreaks and fallbacks are ordinary TypeScript rather than model calls, so any ruling can be recomputed. The source and the audit log are public on GitHub.',
  },
];

export default function FaqPage() {
  return (
    <main className="wrap">
      <FaqJsonLd items={FAQ} />
      <BreadcrumbJsonLd trail={[{ name: 'Questions and answers', path: '/faq' }]} />

      <div className="yard" />
      <h1>Questions and answers</h1>
      <p className="sub">What this is, what we have found, and what it cannot show</p>

      <p className="lede-copy">
        Short answers, each one checkable against the published record. Where the honest
        answer is &ldquo;we do not know yet,&rdquo; that is what it says — the 2026 season has not
        started, and a ranking we would have to retract is worth less than nothing.
      </p>

      <div className="faq">
        {FAQ.map((item) => (
          <section className="faq-item" key={item.question}>
            <h2>{item.question}</h2>
            <p>{item.answer}</p>
          </section>
        ))}
      </div>

      <div className="yard" />
      <p className="lede-copy">
        More detail on how the league is run and what it deliberately does not equalise is on
        the <Link href="/methodology">methodology page</Link>. Results as we get them are in{' '}
        <Link href="/findings">findings</Link>.
      </p>
    </main>
  );
}
