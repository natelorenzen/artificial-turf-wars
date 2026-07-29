'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, X_HANDLE, X_URL, isRehearsalPath } from '@/lib/site/nav';

/**
 * The HUD score-bug bar (SPEC §12 rule 3), with grouped navigation.
 *
 * Groups are labelled in the bar itself rather than hidden behind a dropdown,
 * because the whole point is that a reader always knows whether they are looking at
 * the live season or the rehearsal. A hover menu would hide exactly the distinction
 * that matters.
 */
export function SiteNav() {
  const pathname = usePathname();
  const rehearsal = isRehearsalPath(pathname);

  return (
    <>
      <div className="hud">
        <Link href="/" className="hud-mark">
          ARTIFICIAL <span>TURF WAR</span>
        </Link>

        <nav className="hud-groups" aria-label="Main">
          {NAV.map((group) => (
            <div className="hud-group" key={group.id}>
              <span className="hud-group-label">{group.label}</span>
              <span className="hud-group-items">
                {group.items.map((item) => {
                  const active =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                      {item.label}
                    </Link>
                  );
                })}
              </span>
            </div>
          ))}
        </nav>

        <a className="hud-x" href={X_URL} target="_blank" rel="noopener noreferrer">
          @{X_HANDLE}
        </a>
      </div>

      {rehearsal && (
        <div className="season-banner" role="note">
          <strong>2025 rehearsal.</strong> A dry run against a season whose results were already
          known — not the live league, and nobody won anything. The real season starts in September.{' '}
          <Link href="/">Go to the 2026 league</Link>
        </div>
      )}
    </>
  );
}
