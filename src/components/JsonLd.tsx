import { absoluteUrl, SITE_URL, X_URL } from '@/lib/site/nav';
import type { Post } from '@/lib/blog/posts';

/**
 * Structured data (schema.org / JSON-LD).
 *
 * This is the difference between a search engine reading the page and an ANSWER engine
 * being able to quote it. Google, Perplexity and the rest can parse prose, but they
 * resolve entities and dates far more reliably when told explicitly — and a findings
 * post's value is entirely in "who measured what, when, and can it be checked."
 *
 * Every graph here describes something actually on the page. Marking up claims a reader
 * cannot see is the fastest way to earn a manual action, and on a site whose whole
 * proposition is checkability it would be self-defeating besides.
 */

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

function Script({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is data, not markup. `<` is escaped so a string in the
      // graph can never close the script tag early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** Publisher + site identity. Rendered once, in the root layout. */
export function SiteJsonLd() {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': ORG_ID,
            name: 'Artificial Turf War',
            url: SITE_URL,
            logo: { '@type': 'ImageObject', url: absoluteUrl('/icon') },
            sameAs: [X_URL, 'https://github.com/natelorenzen/artificial-turf-wars'],
            description:
              'An open experiment in which eight frontier language models each manage a fantasy football team for the 2026 NFL season, with every prompt and response published.',
          },
          {
            '@type': 'WebSite',
            '@id': SITE_ID,
            url: SITE_URL,
            name: 'Artificial Turf War',
            publisher: { '@id': ORG_ID },
            inLanguage: 'en',
          },
        ],
      }}
    />
  );
}

/**
 * A findings post.
 *
 * `BlogPosting` rather than `Article`: these are dated observations from an ongoing
 * experiment, not evergreen reference. `dateModified` matters more than usual here —
 * findings 001 was superseded, and an answer engine quoting it should be able to tell
 * how old the claim is.
 */
export function PostJsonLd({ post }: { post: Post }) {
  const url = absoluteUrl(`/findings/${post.slug}`);
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        '@id': `${url}#post`,
        mainEntityOfPage: url,
        url,
        headline: post.title,
        description: post.summary,
        datePublished: new Date(post.date).toISOString(),
        dateModified: new Date(post.date).toISOString(),
        image: absoluteUrl(`/findings/${post.slug}/opengraph-image`),
        author: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
        isPartOf: { '@id': SITE_ID },
        inLanguage: 'en',
        isAccessibleForFree: true,
      }}
    />
  );
}

/**
 * The published decision record, described as a dataset.
 *
 * This is not decoration. Every prompt and unedited response from the season is public
 * and machine-readable, which is a genuine research dataset, and `Dataset` is how you
 * say so in a form Google Dataset Search and answer engines will index.
 */
export function DatasetJsonLd({
  name,
  description,
  path,
  keywords,
}: {
  name: string;
  description: string;
  path: string;
  keywords: string[];
}) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url: absoluteUrl(path),
        creator: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
        isAccessibleForFree: true,
        license: 'https://opensource.org/licenses/MIT',
        keywords,
      }}
    />
  );
}

export interface FaqItem {
  question: string;
  /** Plain text. Rendered into the page too — never mark up an answer a reader cannot see. */
  answer: string;
}

export function FaqJsonLd({ items }: { items: FaqItem[] }) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }}
    />
  );
}

/** Breadcrumbs, so a nested page shows its section rather than a bare URL in results. */
export function BreadcrumbJsonLd({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((crumb, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: crumb.name,
          item: absoluteUrl(crumb.path),
        })),
      }}
    />
  );
}
