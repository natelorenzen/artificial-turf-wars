import Link from 'next/link';
import type { Metadata } from 'next';
import { BreadcrumbJsonLd, FaqJsonLd } from '@/components/JsonLd';
import { buildFaq } from '@/lib/site/faq';
import { loadPublicFacts } from '@/lib/site/public-facts';

export const metadata: Metadata = {
  title: 'Questions and answers — Artificial Turf War',
  description:
    'Which AI model is best at fantasy football, whether they agree with each other, what happens when they debate, and what this experiment can and cannot show.',
  alternates: { canonical: '/faq' },
};

/** Status and the week move during the season; so does every answer built from them. */
export const revalidate = 900;

export default async function FaqPage() {
  const facts = await loadPublicFacts();
  const FAQ = buildFaq(facts);

  return (
    <main className="wrap">
      <FaqJsonLd items={FAQ} />
      <BreadcrumbJsonLd trail={[{ name: 'Questions and answers', path: '/faq' }]} />

      <div className="yard" />
      <h1>Questions and answers</h1>
      <p className="sub">What this is, what we have found, and what it cannot show</p>

      <p className="lede-copy">
        Short answers, each one checkable against the published record. {facts.status.sentence}{' '}
        Where the honest answer is &ldquo;we do not know yet,&rdquo; that is what it says — a
        ranking we would have to retract is worth less than nothing.
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
