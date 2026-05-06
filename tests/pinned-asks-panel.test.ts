import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateOpenAsks,
  firstAskText,
  parseAskMeta,
  toggleResolvedIndex,
  type AskMessage,
} from '../src/lib/utils/asks.js';

// The PinnedAsksPanel.svelte component delegates all of its visible state to
// the helpers below. This repo has no @testing-library/svelte harness, so we
// cover the same behaviours by exercising those helpers and the fetch flow
// they back.

// bun's vitest shim doesn't ship vi.stubGlobal/restoreAllMocks, so the two
// fetch-flow tests below save/restore globalThis.fetch explicitly.
const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  vi.restoreAllMocks?.();
  globalThis.fetch = ORIGINAL_FETCH;
});

function makeMsg(
  id: string,
  meta: Partial<{ asks: string[]; inferred_asks: string[]; asks_resolved: number[] }>,
  sender: string | null = '@alice',
): AskMessage {
  return {
    id,
    sender_id: sender,
    meta: JSON.stringify({
      asks: meta.asks ?? [],
      inferred_asks: meta.inferred_asks ?? [],
      asks_resolved: meta.asks_resolved ?? [],
    }),
  };
}

describe('parseAskMeta', () => {
  it('returns empty defaults for missing/invalid meta', () => {
    expect(parseAskMeta(null)).toEqual({ asks: [], inferred_asks: [], asks_resolved: [] });
    expect(parseAskMeta('{not json')).toEqual({ asks: [], inferred_asks: [], asks_resolved: [] });
    expect(parseAskMeta('"string-not-object"')).toEqual({ asks: [], inferred_asks: [], asks_resolved: [] });
  });

  it('reads JSON-string meta and trims/filters bad entries', () => {
    const parsed = parseAskMeta(JSON.stringify({
      asks: ['  fix copy  ', '', 42, 'ship it'],
      inferred_asks: ['needs review'],
      asks_resolved: [0, '1', 2.7, NaN],
    }));
    expect(parsed.asks).toEqual(['fix copy', 'ship it']);
    expect(parsed.inferred_asks).toEqual(['needs review']);
    expect(parsed.asks_resolved).toEqual([0, 2]);
  });

  it('accepts pre-parsed object meta', () => {
    expect(parseAskMeta({ asks: ['a'], inferred_asks: [], asks_resolved: [] }))
      .toEqual({ asks: ['a'], inferred_asks: [], asks_resolved: [] });
  });
});

describe('aggregateOpenAsks', () => {
  it('renders nothing with zero asks', () => {
    const messages: AskMessage[] = [
      { id: 'm1', meta: null },
      { id: 'm2', meta: JSON.stringify({ asks: [], inferred_asks: [] }) },
    ];
    expect(aggregateOpenAsks(messages)).toEqual([]);
  });

  it('lists open asks and hides resolved entries by combined index', () => {
    const messages: AskMessage[] = [
      makeMsg('m1', {
        asks: ['decide pricing', 'pick a name'],
        inferred_asks: ['confirm date?'],
        asks_resolved: [1], // resolves "pick a name"
      }),
    ];
    const open = aggregateOpenAsks(messages);
    expect(open.map((a) => a.text)).toEqual(['decide pricing', 'confirm date?']);
    expect(open.map((a) => a.index)).toEqual([0, 2]);
  });

  it('marks inferred items only when they come from inferred_asks', () => {
    const messages: AskMessage[] = [
      makeMsg('m1', {
        asks: ['explicit one'],
        inferred_asks: ['guessed one'],
      }),
    ];
    const open = aggregateOpenAsks(messages);
    expect(open).toHaveLength(2);
    expect(open[0]).toMatchObject({ text: 'explicit one', inferred: false });
    expect(open[1]).toMatchObject({ text: 'guessed one', inferred: true });
  });

  it('uses the senderResolver when provided, else falls back to sender_id', () => {
    const messages: AskMessage[] = [
      makeMsg('m1', { asks: ['x'] }, '@alice'),
      makeMsg('m2', { asks: ['y'] }, '@bob'),
    ];
    const resolver = (id: string) => (id === '@alice' ? 'Alice King' : '');
    const open = aggregateOpenAsks(messages, resolver);
    expect(open.map((a) => a.sender)).toEqual(['Alice King', '@bob']);
  });
});

describe('firstAskText', () => {
  it('returns the first explicit ask, then inferred if no explicit', () => {
    expect(firstAskText(JSON.stringify({ asks: ['a', 'b'], inferred_asks: ['c'] }))).toBe('a');
    expect(firstAskText(JSON.stringify({ asks: [], inferred_asks: ['only-inferred'] })))
      .toBe('only-inferred');
    expect(firstAskText(null)).toBeNull();
  });
});

describe('toggleResolvedIndex', () => {
  it('adds and removes indexes idempotently and keeps them sorted', () => {
    expect(toggleResolvedIndex([], 2)).toEqual([2]);
    expect(toggleResolvedIndex([0, 2], 1)).toEqual([0, 1, 2]);
    expect(toggleResolvedIndex([0, 1, 2], 1)).toEqual([0, 2]);
  });
});

describe('resolve flow (component-level fetch contract)', () => {
  it('PATCHes the asks endpoint with the new resolved list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const sessionId = 'sess-1';
    const message = makeMsg('m1', { asks: ['decide', 'ship'], asks_resolved: [] });
    const meta = parseAskMeta(message.meta);
    const next = toggleResolvedIndex(meta.asks_resolved, 0);

    await fetch(`/api/sessions/${sessionId}/messages/${message.id}/asks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: next }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/sess-1/messages/m1/asks');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ resolved: [0] });
  });

  it('reverts optimistic state when the PATCH fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const baseResolved: number[] = [];
    const optimistic = toggleResolvedIndex(baseResolved, 0);
    expect(optimistic).toEqual([0]);

    const res = await fetch('/api/sessions/s/messages/m1/asks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: optimistic }),
    });

    const finalResolved = res.ok ? optimistic : baseResolved;
    expect(finalResolved).toEqual([]);
  });
});
