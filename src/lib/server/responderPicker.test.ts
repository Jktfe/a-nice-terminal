import { describe, expect, it } from 'vitest';
import { pickNextResponder, type ResponderWithStatus } from './responderPicker';

function mk(handle: string, paneStatus: ResponderWithStatus['pane_status'], orderIndex = 1000): ResponderWithStatus {
  return { terminal_id: `t-${handle}`, order_index: orderIndex, pane_status: paneStatus, handle };
}

describe('pickNextResponder', () => {
  it('returns null on empty list (covers both empty AND null senderHandle)', () => {
    expect(pickNextResponder([], '@anyone')).toBeNull();
    expect(pickNextResponder([], null)).toBeNull();
  });

  it('returns the single verified responder when it is not the sender', () => {
    const pick = pickNextResponder([mk('@a', 'verified')], '@b');
    expect(pick?.handle).toBe('@a');
  });

  it('returns null when the only responder IS the sender', () => {
    expect(pickNextResponder([mk('@a', 'verified')], '@a')).toBeNull();
  });

  it('returns null when all responders are non-verified', () => {
    const list = [mk('@a', 'unknown'), mk('@b', 'stale'), mk('@c', 'unknown')];
    expect(pickNextResponder(list, '@sender')).toBeNull();
  });

  it('skips the sender when first-in-list, returns next verified', () => {
    const list = [mk('@a', 'verified', 1000), mk('@b', 'verified', 2000)];
    const pick = pickNextResponder(list, '@a');
    expect(pick?.handle).toBe('@b');
  });

  it('returns first-verified across mixed statuses, walking order_index', () => {
    const list = [mk('@a', 'stale', 1000), mk('@b', 'unknown', 2000), mk('@c', 'verified', 3000), mk('@d', 'verified', 4000)];
    const pick = pickNextResponder(list, '@sender');
    expect(pick?.handle).toBe('@c');
  });

  it('respects the caller-supplied order: order_index is NOT re-sorted by picker', () => {
    // Caller is expected to pass already-sorted list (listRespondersForRoom does
    // ORDER BY order_index ASC). Picker honours iteration order as-given.
    const list = [mk('@second', 'verified', 5000), mk('@first', 'verified', 1000)];
    const pick = pickNextResponder(list, '@sender');
    expect(pick?.handle).toBe('@second');
  });

  it('null senderHandle path: just returns first verified (no skip step)', () => {
    const list = [mk('@only', 'verified')];
    expect(pickNextResponder(list, null)?.handle).toBe('@only');
  });

  it('mixed: sender is verified at position 0, rest are stale → returns null', () => {
    const list = [mk('@a', 'verified', 1000), mk('@b', 'stale', 2000), mk('@c', 'unknown', 3000)];
    expect(pickNextResponder(list, '@a')).toBeNull();
  });
});
