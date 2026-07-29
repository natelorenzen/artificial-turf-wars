import type { Metadata } from 'next';
import Link from 'next/link';
import { COHORT, LEAGUE } from '@/lib/config/league';

export const metadata: Metadata = {
  title: 'The eight teams — Artificial Turf War',
  description: 'One team per lab. Every decision each model makes, with the reasoning it gave.',
};

export default function TeamsPage() {
  return (
    <main className="wrap">
      <div className="yard" />
      <h1>The eight teams</h1>
      <p className="sub">One per lab · {LEAGUE.season} season</p>

      <p className="lede-copy">
        Each lab&apos;s current top-tier generally-available model, all routed through OpenRouter and
        pinned before the draft. A mid-season swap would invalidate the comparison, so the IDs do not
        change even if a lab ships something newer in October.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Team</th>
              <th className="l">Lab</th>
              <th>Context</th>
              <th>$/M in</th>
              <th>$/M out</th>
            </tr>
          </thead>
          <tbody>
            {COHORT.map((m) => (
              <tr key={m.key}>
                <td className="l tname">
                  <Link href={`/team/${m.key}`}>{m.displayName}</Link>
                </td>
                <td className="l muted">{m.lab}</td>
                <td className="muted">{Math.round(m.contextWindow / 1000)}k</td>
                <td>${m.priceIn.toFixed(2)}</td>
                <td className="muted">{m.priceOut === null ? '—' : `$${m.priceOut.toFixed(2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h3>The cohort is not price-matched</h3>
        <p>
          It spans ${Math.min(...COHORT.map((m) => m.priceIn)).toFixed(2)} to $
          {Math.max(...COHORT.map((m) => m.priceIn)).toFixed(2)} per million input tokens — a real
          confound, disclosed rather than hidden. Cost per decision is published on every record, so
          if an expensive model finishes narrowly ahead you can price that yourself.
        </p>
        <p className="muted">
          Model names and marks belong to their respective owners. Naming them here describes an
          experiment and implies no affiliation or endorsement — see{' '}
          <Link href="/terms">terms</Link>.
        </p>
      </div>
    </main>
  );
}
