import { describe, expect, it } from 'vitest';
import { resolveAddressedKind } from './addressedToViewer';

const ME = '@claudev4';
const OTHER = '@speedyclaude';

describe('resolveAddressedKind', () => {
  it('A1: returns null when asHandle is undefined', () => {
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'hello @claudev4' },
      null,
      undefined
    )).toBe(null);
  });

  it('A2: returns null when asHandle is the page placeholder "@you"', () => {
    // Without this guard, a literal "@you" in any message body would
    // false-positive every message.
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'fyi @you should look at this' },
      null,
      '@you'
    )).toBe(null);
  });

  it('A3: returns null when the message is the viewer\'s own (no self-badge)', () => {
    expect(resolveAddressedKind(
      { authorHandle: ME, body: 'reminder to self' },
      null,
      ME
    )).toBe(null);
  });

  it('A4: returns "reply" when parent message author is the viewer', () => {
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'agreed' },
      { authorHandle: ME },
      ME
    )).toBe('reply');
  });

  it('A5: returns "mention" when the body has a bare @-mention of the viewer', () => {
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'thoughts on this @claudev4?' },
      null,
      ME
    )).toBe('mention');
  });

  it('A6: prefers "reply" over "mention" when both signals fire', () => {
    // Operator's own message was the parent AND the reply also @-tags
    // them. The reply signal is the stronger framing.
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'good catch @claudev4' },
      { authorHandle: ME },
      ME
    )).toBe('reply');
  });

  it('A7: returns null when bracketed informational mention is the only match', () => {
    // [@handle] is informational per mentionRouting.ts; should not
    // trigger a recipient-side badge.
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'context for [@claudev4]: see thread' },
      null,
      ME
    )).toBe(null);
  });

  it('A8: returns null when parent author is a third party (not the viewer)', () => {
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'k' },
      { authorHandle: '@third-party' },
      ME
    )).toBe(null);
  });

  it('A9: case-sensitive on handle match (matches mentionRouting convention)', () => {
    // listBareMentionHandles preserves case from the body, so an
    // exact-case match is required. Mismatched case → no badge.
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'hi @ClaudeV4' },
      null,
      ME
    )).toBe(null);
  });

  it('A10: handles empty asHandle string defensively', () => {
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'hello world' },
      null,
      ''
    )).toBe(null);
  });

  it('A11: returns null when the message has been tombstoned (deletedAtMs set)', () => {
    // Gemini-code-assist follow-up: a deleted message replying to me
    // renders as a tombstone — nothing for me to act on, so the badge
    // would be noise. Reply guard + mention guard both elide.
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'sorry @claudev4', deletedAtMs: Date.now() },
      { authorHandle: ME },
      ME
    )).toBe(null);
    expect(resolveAddressedKind(
      { authorHandle: OTHER, body: 'hey @claudev4 check this', deletedAtMs: Date.now() },
      null,
      ME
    )).toBe(null);
  });
});
