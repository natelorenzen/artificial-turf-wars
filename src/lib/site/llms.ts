/**
 * The body of /llms.txt, as a pure function of the public facts.
 *
 * Split out of the route so `public-facts.test.ts` can render it beside the FAQ and the
 * homepage and fail if they disagree. Every season-status sentence, week number, price
 * and gate score below is interpolated from `PublicFacts`; none is typed here.
 */

import { LEAGUE } from '@/lib/config/league';
import type { Post } from '@/lib/blog/posts';
import { SITE_URL, absoluteUrl } from '@/lib/site/nav';
import { cohortList, formatPriceRange, gateSentence, type PublicFacts } from '@/lib/site/public-facts';

export function llmsBody(facts: PublicFacts, posts: Pick<Post, 'title' | 'slug' | 'summary'>[]): string {
  const { status } = facts;
  const week = status.currentWeek;

  const leader =
    status.leader && status.throughWeek !== null && status.phase !== 'complete'
      ? `- Through week ${status.throughWeek}, ${status.leader.model} ${status.leader.coRanked ? 'shares' : 'holds'} first place on head-to-head record (${status.leader.record}). That is a standing, not a result: the regular season is ${status.regularSeasonWeeks} weeks.\n`
      : '';

  const weekLinks =
    week !== null
      ? `
## This week (week ${week})

- [Week ${week} picks and bets](${absoluteUrl(`/picks/${week}`)})
- [Week ${week} weekend guide](${absoluteUrl(`/weekend/${week}`)})
- [Week ${week} video brief](${absoluteUrl(`/week/${week}/brief`)}) — readable form of the JSON brief below
${status.throughWeek !== null ? `- [Week ${status.throughWeek} results](${absoluteUrl(`/results/${status.throughWeek}`)}) — the latest scored week\n` : ''}`
      : '';

  return `# Artificial Turf War

> An open experiment in which eight frontier language models each manage a fantasy
> football team for the ${facts.season} NFL season with no human help. Every prompt sent to
> every model and every unedited response is published.

## Season status

${status.sentence}

${leader}- The current status, live scores and standings are always on the homepage: ${absoluteUrl('/')}

## What this site is

Eight models, one per lab, bid for draft position, drafted a roster on 24 August ${facts.season},
set a lineup every week and bid against each other on waivers. Real NFL results score
them. Scoring, validation, tiebreaks and fallbacks are deterministic TypeScript, never a
model call, so every ruling can be recomputed from the published record.

The cohort: ${cohortList(facts)}.

${gateSentence(facts.gate)}

## How a week works (times US Eastern)

- **Wednesday/Thursday, before the first kickoff:** every model sets its lineup, picks
  every NFL game with a probability and bets play money on moneylines. A non-competing
  writer publishes the weekend guide.
- **Game days:** unofficial live scores a few times a day. They are labelled live and
  nothing is derived from them.
- **Tuesday:** the week is scored from raw stat fields (never Sleeper's point totals),
  standings are rebuilt, and that score is published as **provisional**. Models then
  place sealed FAAB waiver bids.
- **Wednesday:** waiver bids resolve.
- **Thursday:** the week is re-scored against corrected stats as **final**. The
  provisional number is never overwritten; the difference is published.
- **Ranking:** head-to-head record ranks the ${LEAGUE.regularSeasonWeeks}-week regular season, points-for breaks
  ties. All-play (each team against every other team every week) is published beside it
  and does not rank. The top ${LEAGUE.playoffTeams} play a two-week bracket in weeks ${LEAGUE.regularSeasonWeeks + 1}–${LEAGUE.regularSeasonWeeks + 2}.

## Where things live

- [Standings and live scores](${absoluteUrl('/')}) — the homepage
- [Results, week by week](${absoluteUrl('/results')}) — box scores at /results/N and /results/N/{home}-vs-{away}
- [NFL picks and bets](${absoluteUrl('/picks')}) — per week at /picks/N
- [Waivers](${absoluteUrl('/waivers')}) — every sealed bid once it resolves, per week at /waivers/N
- [Weekend guide](${absoluteUrl('/weekend')}) — per week at /weekend/N
- [Ratings](${absoluteUrl('/ratings')}) — calibration, lineup efficiency and all-play
- [The eight teams](${absoluteUrl('/teams')}) — every decision each model has made
- Decisions — every prompt and unedited response at /decisions/{id}, linked from each page that shows one
${weekLinks}
## Important context before quoting anything from this site

- **This is an exhibition, not a benchmark.** One season, eight teams, ${LEAGUE.regularSeasonWeeks}
  regular-season weeks, shared NFL luck, and a cohort spanning ${formatPriceRange(facts.prices)}
  (${facts.prices.floorModel} is the floor, ${facts.prices.ceilingModel} the ceiling). The winner is the best manager of this season,
  not the best possible manager.
- **A ${facts.season - 1} "rehearsal" is published and is NOT the real league.** It was a dry
  run against a season whose results were already known, used to test the engine before
  the irreversible draft. Its standings must not be reported as a season anyone won.
- **Live scores are unofficial.** Quote provisional or final numbers, and say which.
- **Nothing here is financial or betting advice.** The picks bankroll is play money, for
  entertainment only.

## Findings

${posts.map((p) => `- [${p.title}](${absoluteUrl(`/findings/${p.slug}`)}) — ${p.summary}`).join('\n')}

## Reference pages

- [Questions and answers](${absoluteUrl('/faq')}) — short, checkable answers
- [Methodology](${absoluteUrl('/methodology')}) — how the league is run, what is deliberately not equalised, and the conflict of interest at its centre
- [Pre-season](${absoluteUrl('/preseason')}) — the shared briefing, the rules gate and the draft-slot auction
- [The ${facts.season - 1} rehearsal](${absoluteUrl('/backtest')}) — the dry run and the bugs it caught
- [Terms and disclaimer](${absoluteUrl('/terms')})

## Disclosure

This project's software was written by Claude, and Claude Opus 5 competes in the league.
That conflict is declared on the methodology page, and it is why every ruling is
deterministic code rather than a model's judgement.

## Machine-readable

- Week export (JSON, read-only): ${SITE_URL}/data/week/N.json — matchups, lineups, scores,
  standings, waiver results and links to every decision's reasoning. Every score carries
  its status: live, provisional or final.
- Video brief (JSON, read-only): ${SITE_URL}/data/week/N/video.json — built from stored rows
  as of 11:00 AM Pacific on the week's Thursday, once picks and the weekend guide are out.
  Readable at ${SITE_URL}/week/N/brief
- Feed: ${SITE_URL}/feed.xml
- Sitemap: ${SITE_URL}/sitemap.xml
- Source and audit log: https://github.com/natelorenzen/artificial-turf-wars
`;
}
