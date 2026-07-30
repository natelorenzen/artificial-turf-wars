'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, X_HANDLE, X_URL, isRehearsalPath } from '@/lib/site/nav';
import { PixelMark } from '@/components/PixelMark';

/**
 * The HUD score-bug bar (SPEC §12 rule 3).
 *
 * Nothing here is behind a dropdown, because the whole point is that a reader always
 * knows whether they are looking at the live season or the rehearsal, and a hover menu
 * would hide exactly the distinction that matters. But the distinction now rides on the
 * links themselves (`item.tag`) rather than on headings stacked above them: one row
 * instead of two, and the marker cannot get orphaned from its link by a wrap or a
 * breakpoint. Groups survive as spacing, separated by a rule.
 */
export function SiteNav() {
  const pathname = usePathname();
  const rehearsal = isRehearsalPath(pathname);

  return (
    <>
      <div className="hud">
        <Link href="/" className="hud-mark">
          <PixelMark scale={5} />
          <span className="hud-mark-words">
            ARTIFICIAL <span>TURF WAR</span>
          </span>
        </Link>

        <nav className="hud-groups" aria-label="Main">
          {NAV.map((group) => (
            <div className="hud-group" key={group.id}>
              {group.items.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.tag && <span className="nav-tag">{item.tag}</span>}
                    {item.label}
                  </Link>
                );
              })}
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
