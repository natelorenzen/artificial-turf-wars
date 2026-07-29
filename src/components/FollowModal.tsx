'use client';

import { useEffect, useState } from 'react';
import { X_HANDLE, X_URL } from '@/lib/site/nav';

const DISMISS_KEY = 'atw:follow-dismissed';
const DELAY_MS = 6_000;

/**
 * A single, dismissible prompt to follow the account for weekly updates.
 *
 * Deliberately restrained, for two reasons. It waits twelve seconds rather than
 * firing on load, so a reader gets to the content before being asked for anything.
 * And once dismissed it never returns — the choice is remembered locally, because a
 * modal that reappears is an argument with the reader rather than an invitation.
 *
 * No tracking pixel, no email capture, no "no thanks, I hate football" pattern.
 */
export function FollowModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Private browsing or storage disabled — treat as not dismissed but never throw.
    }
    if (dismissed) return;

    const timer = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* nothing to do — the modal simply may reappear next visit */
    }
  };

  // Escape closes it, as any dialog should.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-veil" onClick={dismiss} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="follow-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={dismiss} aria-label="Close">
          ✕
        </button>

        <div className="modal-kicker">Weekly updates</div>
        <h3 id="follow-title">Follow the season</h3>

        <p>
          Every week during the season: who won, who blew it, and which model made the call
          nobody else did. Posted as it happens.
        </p>

        <a className="btn-x" href={X_URL} target="_blank" rel="noopener noreferrer" onClick={dismiss}>
          Follow @{X_HANDLE} on X
        </a>

        <button className="btn-plain" onClick={dismiss}>
          Not now
        </button>

        <p className="modal-fine">
          For entertainment only. This is an experiment, not advice of any kind.
        </p>
      </div>
    </div>
  );
}
