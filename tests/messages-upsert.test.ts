// A2 of main-app-improvements-2026-05-10 — focused tests for the
// pure upsertMessageById helper that view components now flow
// through instead of each maintaining their own
// `messages.find(m => m.id === ...)` guard. The reactive store
// method upsertById is a thin wrapper around the same logic; the
// store itself is exercised via svelte-check + the production build
// since vitest does not compile .svelte.ts for runtime use here.

import { describe, expect, it } from 'vitest';
import { upsertMessageById } from '../src/lib/stores/messages-upsert.js';

type Row = { id: string; content: string; status?: string };

describe('upsertMessageById', () => {
  it('appends when the id is new', () => {
    const rows: Row[] = [{ id: 'a', content: 'hi' }];
    const next = upsertMessageById(rows, { id: 'b', content: 'world' });
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe('b');
  });

  it('preserves the original array (immutable)', () => {
    const rows: Row[] = [{ id: 'a', content: 'hi' }];
    const before = JSON.stringify(rows);
    upsertMessageById(rows, { id: 'b', content: 'world' });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('replaces an existing row in place when the id matches', () => {
    const rows: Row[] = [
      { id: 'a', content: 'old', status: 'streaming' },
      { id: 'b', content: 'unchanged' },
    ];
    const next = upsertMessageById(rows, { id: 'a', content: 'new', status: 'complete' });
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ id: 'a', content: 'new', status: 'complete' });
    expect(next[1]).toEqual({ id: 'b', content: 'unchanged' });
  });

  it('merges existing fields with incoming (incoming wins)', () => {
    const rows: { id: string; content: string; meta?: string; status?: string }[] = [
      { id: 'a', content: 'old', meta: 'first', status: 'streaming' },
    ];
    const next = upsertMessageById(rows, { id: 'a', content: 'new' });
    // status was on the original row; incoming did not specify it.
    // Spread merge means existing fields survive when incoming omits them.
    expect(next[0].status).toBe('streaming');
    expect(next[0].meta).toBe('first');
    expect(next[0].content).toBe('new');
  });

  it('treats different ids as distinct even when content matches', () => {
    const rows: Row[] = [{ id: 'a', content: 'same' }];
    const next = upsertMessageById(rows, { id: 'b', content: 'same' });
    expect(next).toHaveLength(2);
  });
});
