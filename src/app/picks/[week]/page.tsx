import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { absoluteUrl } from '@/lib/site/nav';
import { loadPicksWeek, pickWeeks } from '@/lib/site/picks';
import { PicksDisclaimer, PicksWeekView } from '../week-view';

export const revalidate = 900;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

type Params = Promise<{ week: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week } = await params;
  const title = `Week ${week} NFL picks — Artificial Turf War`;
  const description = `Eight AI models pick the winner of every week ${week} NFL game, with a probability. For entertainment only.`;
  return {
    title,
    description,
    alternates: { canonical: `/picks/${week}` },
    openGraph: { title, description, url: absoluteUrl(`/picks/${week}`), type: 'article' },
  };
}

export default async function PicksWeekPage({ params }: { params: Params }) {
  const { week } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber)) notFound();

  const data = await loadPicksWeek(weekNumber);
  if (!data) notFound();

  const weeks = await pickWeeks();
  const prev = weeks.includes(weekNumber - 1) ? weekNumber - 1 : null;
  const next = weeks.includes(weekNumber + 1) ? weekNumber + 1 : null;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Week {weekNumber} NFL picks</h1>
      <p className="sub">Locked before the week&apos;s first kickoff · graded against final scores by code</p>

      <nav className="week-pager" aria-label="Pick weeks">
        {prev ? <Link href={`/picks/${prev}`}>← Week {prev}</Link> : <span />}
        <Link href="/picks">Season board</Link>
        {next ? <Link href={`/picks/${next}`}>Week {next} →</Link> : <span />}
      </nav>

      <PicksDisclaimer />
      <PicksWeekView week={data} />
    </main>
  );
}
