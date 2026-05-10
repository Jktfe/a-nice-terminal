// A1 of main-app-improvements-2026-05-10 — focused tests for the
// shared mention-autocomplete composable and the pure helpers it
// uses. MessageInput and GridSlot now both flow through this; the
// regressions to guard against are: divergent fuzzy ranking, missing
// @everyone pin, mishandled cursor offset on selection.

// The reactive composable itself (MentionAutocomplete) is a thin wrapper
// around these helpers — it just lifts them into Svelte 5 $state/$derived.
// Vitest does not compile .svelte.ts here, so we cover the pure helper
// surface directly; svelte-check + the production build prove the
// composable wires them correctly into both call sites.

import { describe, expect, it } from 'vitest';
import {
  applyMentionSelection,
  detectMentionTrigger,
  filterAndScoreHandles,
  fuzzyScoreMention,
  pinEveryoneFirst,
} from '../src/lib/utils/mentions.js';

const handles = [
  { handle: '@claude', name: 'Claude' },
  { handle: '@codex', name: 'Codex' },
  { handle: '@gemini', name: 'Gemini' },
  { handle: '@everyone', name: 'Everyone' },
];

describe('fuzzyScoreMention', () => {
  it('ranks exact matches above prefix matches above substring above subsequence', () => {
    expect(fuzzyScoreMention('claude', 'claude')).toBe(1000);
    expect(fuzzyScoreMention('cla', 'claude')).toBeGreaterThanOrEqual(497);
    expect(fuzzyScoreMention('aud', 'claude')).toBeGreaterThanOrEqual(197);
    expect(fuzzyScoreMention('cd', 'claude')).toBeGreaterThan(0);
    expect(fuzzyScoreMention('cd', 'claude')).toBeLessThan(50 + 60);
  });

  it('returns 0 when the query characters do not appear in order', () => {
    expect(fuzzyScoreMention('xy', 'claude')).toBe(0);
  });
});

describe('pinEveryoneFirst', () => {
  it('moves @everyone to the front and preserves the rest of the order', () => {
    const result = pinEveryoneFirst(handles);
    expect(result[0].handle).toBe('@everyone');
    expect(result.slice(1).map((h) => h.handle)).toEqual(['@claude', '@codex', '@gemini']);
  });

  it('synthesises @everyone if the source list omits it', () => {
    const result = pinEveryoneFirst([{ handle: '@claude', name: 'Claude' }]);
    expect(result[0]).toEqual({ handle: '@everyone', name: 'Everyone' });
  });
});

describe('filterAndScoreHandles', () => {
  it('returns the first N entries for an empty query', () => {
    expect(filterAndScoreHandles(handles, '', 3)).toEqual(handles.slice(0, 3));
  });

  it('orders by descending score across handle and display name', () => {
    const result = filterAndScoreHandles(handles, 'co');
    expect(result[0].handle).toBe('@codex');
  });

  it('drops zero-scored entries instead of returning them', () => {
    const result = filterAndScoreHandles(handles, 'zzz');
    expect(result).toEqual([]);
  });
});

describe('detectMentionTrigger', () => {
  it('finds the trigger when text ends in @partial at the cursor', () => {
    const result = detectMentionTrigger('hi @cla', 7);
    expect(result).toEqual({ start: 3, query: 'cla' });
  });

  it('returns null when there is no @ before the cursor', () => {
    expect(detectMentionTrigger('hi everyone', 11)).toBeNull();
  });

  it('returns null once a space terminates the partial handle', () => {
    expect(detectMentionTrigger('hi @claude ', 11)).toBeNull();
  });
});

describe('applyMentionSelection', () => {
  it('replaces the partial handle with the selected handle and a trailing space', () => {
    const result = applyMentionSelection('hi @cla', 7, 3, '@claude');
    expect(result.text).toBe('hi @claude ');
    expect(result.cursorAfter).toBe(11);
  });

  it('preserves trailing text after the cursor', () => {
    // Cursor at 6 = after the second char of `@co`, before the space.
    // Selection replaces the @co range (3..6) with `@codex `.
    const result = applyMentionSelection('hi @co world', 6, 3, '@codex');
    expect(result.text).toBe('hi @codex  world');
    expect(result.cursorAfter).toBe(10);
  });
});

describe('mention helper composition (mirrors composable detect/apply pipeline)', () => {
  it('detect → apply round-trip replaces the partial @handle correctly', () => {
    const text = 'hi @co';
    const cursor = text.length;
    const trigger = detectMentionTrigger(text, cursor);
    expect(trigger).not.toBeNull();
    const filtered = filterAndScoreHandles(pinEveryoneFirst(handles), trigger!.query);
    expect(filtered[0].handle).toBe('@codex');
    const result = applyMentionSelection(text, cursor, trigger!.start, filtered[0].handle);
    expect(result.text).toBe('hi @codex ');
    expect(result.cursorAfter).toBe(10);
  });

  it('detect returns null once the @handle is already terminated by a space', () => {
    expect(detectMentionTrigger('hi @claude ', 11)).toBeNull();
  });
});
