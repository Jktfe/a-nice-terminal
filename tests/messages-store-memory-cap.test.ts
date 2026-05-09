// M1 of chat-room-load-perf-2026-05-09: messages array must not grow
// unboundedly. loadOlder appends fresh rows; when the resulting array
// would exceed MAX_MESSAGES_IN_MEMORY, the newest tail is dropped so
// the user keeps the older context they just scrolled up to fetch.
//
// The store uses Svelte runes ($state) which the vitest runner can't
// evaluate directly, so this test asserts the contract by reading the
// source text — the same pattern as tests/toast-store.test.ts.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('messages store memory cap (M1)', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/stores/messages.svelte.ts'),
    'utf8',
  );

  it('declares the hard cap as MAX_MESSAGES_IN_MEMORY at 1000', () => {
    expect(source).toContain('const MAX_MESSAGES_IN_MEMORY = 1000');
  });

  it('drops the newest tail when loadOlder would push past the cap', () => {
    // The fix slices [0, MAX_MESSAGES_IN_MEMORY] so the older end
    // (which the user just scrolled up to fetch) is preserved.
    expect(source).toContain('next.length > MAX_MESSAGES_IN_MEMORY');
    expect(source).toContain('next.slice(0, MAX_MESSAGES_IN_MEMORY)');
  });

  it('preserves hasMoreMessages so older fetches keep working after a cap', () => {
    // After capping, hasMoreMessages = older.length >= limit must still
    // run — capping doesn't end the conversation, just bounds memory.
    expect(source).toMatch(/hasMoreMessages = older\.length >= limit/);
  });

  it('does not retroactively bound load() — the initial fetch is already PAGE_SIZE', () => {
    // load() builds messages from a single fetch; it can't exceed PAGE_SIZE,
    // so no separate cap is needed there. Assert this stays true.
    expect(source).toMatch(/messages = rows;/);
    // No second slice/cap call inside load() — only loadOlder needs it.
    const loadFn = source.match(/async function load\b[\s\S]*?async function/);
    expect(loadFn?.[0]).toBeDefined();
    expect(loadFn?.[0]).not.toContain('MAX_MESSAGES_IN_MEMORY');
  });
});
