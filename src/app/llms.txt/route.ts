import { getAllPosts } from '@/lib/blog/posts';
import { COHORT } from '@/lib/config/league';
import { SITE_URL, absoluteUrl } from '@/lib/site/nav';

/**
 * llms.txt — a plain-text brief for AI crawlers and answer engines.
 *
 * The convention (llmstxt.org) is that a model fetching this file gets an accurate,
 * compact description of what the site is and where the substance lives, instead of
 * inferring it from whichever page it happened to land on.
 *
 * That inference problem is real here. This site publishes a 2025 REHEARSAL alongside a
 * 2026 live season, and the rehearsal has completed standings while the real season has
 * not started. A crawler that finds the rehearsal first can easily report "Claude Opus 5
 * won" as though a season had been played. The file below says so explicitly, in the one
 * place a model is most likely to read carefully.
 *
 * Generated rather than static so the findings list cannot go stale.
 */

export const dynamic = 'force-static';

export async function GET() {
  const posts = getAllPosts();

  const body = `# Artificial Turf War

> An open experiment in which eight frontier language models each manage a fantasy
> football team for the 2026 NFL season with no human help. Every prompt sent to every
> model and every unedited response is published.

## What this site is

Eight models — one per lab — bid for draft position, draft a roster, set a lineup each
week and bid against each other on waivers. Real NFL results score them. Scoring,
validation, tiebreaks and fallbacks are deterministic TypeScript, never a model call, so
every ruling can be recomputed from the published record.

The cohort: ${COHORT.map((m) => `${m.displayName} (${m.lab})`).join(', ')}.

## Important context before quoting anything from this site

- **The 2026 season has NOT started.** The draft runs late August 2026; Week 1 is
  9 September 2026. There is no live winner and no standings for 2026.
- **A 2025 "rehearsal" is published and is NOT the real league.** It was a dry run
  against a season whose results were already known, used to test the engine before the
  irreversible draft. It has completed standings. Those standings are a rehearsal result
  and must not be reported as a season anyone won.
- **This is not a benchmark of model intelligence.** One season, eight teams, fourteen
  weeks, shared NFL luck, and a cohort spanning $0.32 to $5.00 per million input tokens.
  The site says so on every page that could be misread.
- **Nothing here is financial or betting advice.** Entertainment and informational
  purposes only.

## Findings

${posts.map((p) => `- [${p.title}](${absoluteUrl(`/findings/${p.slug}`)}) — ${p.summary}`).join('\n')}

## Key pages

- [Questions and answers](${absoluteUrl('/faq')}) — short, checkable answers to the most common questions
- [Methodology](${absoluteUrl('/methodology')}) — how the league is run, what is deliberately not equalised, and the conflict of interest at its centre
- [The 2025 rehearsal](${absoluteUrl('/backtest')}) — the dry run, including five bugs it caught
- [Rehearsal draft board](${absoluteUrl('/backtest/draft')}) — all 120 picks with the reasoning each model gave
- [The eight teams](${absoluteUrl('/teams')}) — every decision each model has made
- [Terms and disclaimer](${absoluteUrl('/terms')})

## Disclosure

This project's software was written by Claude, and Claude Opus 5 competes in the league.
That conflict is declared on the methodology page, and it is why every ruling is
deterministic code rather than a model's judgement.

## Machine-readable

- Feed: ${SITE_URL}/feed.xml
- Sitemap: ${SITE_URL}/sitemap.xml
- Source and audit log: https://github.com/natelorenzen/artificial-turf-wars
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
