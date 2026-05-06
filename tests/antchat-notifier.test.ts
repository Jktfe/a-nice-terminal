// Tests for antchat/lib/notifier.ts mention detection.
//
// notify() is a thin shell over osascript; we don't exercise it from CI to
// avoid darwin-only flakiness. mentionsHandle() is pure logic and worth
// pinning down so a stray regex change doesn't silently mute notifications.

import { describe, it, expect } from 'vitest';
import { mentionsHandle, notifierAvailable } from '../antchat/lib/notifier.js';

describe('notifier.mentionsHandle', () => {
  it('matches a @handle at the start of the message', () => {
    expect(mentionsHandle('@stevo got a sec?', '@stevo')).toBe(true);
  });

  it('matches a @handle in the middle of the message', () => {
    expect(mentionsHandle('hey @stevo, got a sec?', '@stevo')).toBe(true);
  });

  it('matches a @handle even when caller passes the bare name without @', () => {
    expect(mentionsHandle('hey @stevo!', 'stevo')).toBe(true);
  });

  it('does NOT fire on a longer handle that contains the target as a prefix', () => {
    // @stev should not match @stevo
    expect(mentionsHandle('hey @stevo!', '@stev')).toBe(false);
  });

  it('does NOT fire when the target is followed by an alnum/underscore', () => {
    expect(mentionsHandle('look at @stevo_alt', '@stevo')).toBe(false);
  });

  it('does NOT fire when the @ is part of an email', () => {
    // 'stevo@gmail.com' — leading char is alnum so the boundary fails.
    expect(mentionsHandle('email stevo@gmail.com', '@stevo')).toBe(false);
  });

  it('handles regex-special chars in the handle defensively', () => {
    // Practical handles never contain `.`, but the implementation must not
    // throw on bizarre input.
    expect(mentionsHandle('mention @a.b here', '@a.b')).toBe(true);
    expect(mentionsHandle('mention @aXb here', '@a.b')).toBe(false);
  });

  it('returns false for empty / nullish input', () => {
    expect(mentionsHandle('', '@stevo')).toBe(false);
    expect(mentionsHandle('hey @stevo', '')).toBe(false);
    expect(mentionsHandle('hey @stevo', null)).toBe(false);
    expect(mentionsHandle('hey @stevo', undefined)).toBe(false);
  });
});

describe('notifier.notifierAvailable', () => {
  it('reflects the running platform', () => {
    expect(notifierAvailable()).toBe(process.platform === 'darwin');
  });
});
