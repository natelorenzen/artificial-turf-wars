import { describe, expect, it } from 'vitest';
import { bidIsResolved } from './sources';

describe('bidIsResolved', () => {
  it('treats a freshly written sealed bid as unresolved, whatever its won default says', () => {
    // `waiver_bids.won` is `not null default false`: this is every bid on a Tuesday.
    expect(bidIsResolved({ won: false, losing_reason: null })).toBe(false);
  });

  it('treats a winner, or a loser with a reason, as resolved', () => {
    expect(bidIsResolved({ won: true, losing_reason: null })).toBe(true);
    expect(bidIsResolved({ won: false, losing_reason: 'outbid' })).toBe(true);
  });
});
