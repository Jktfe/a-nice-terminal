import { describe, expect, it } from 'vitest';
import { roomBookmarks, sortByBookmark } from './roomBookmarks.svelte';

describe('sortByBookmark', () => {
  it('returns rooms unchanged when nothing is bookmarked', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(sortByBookmark(rooms, [])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('floats bookmarked rooms to the top in the order they appear in bookmarkedIds (#155 reorder)', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    // The previous contract was "rooms-order wins". After #155 the
    // bookmark-array order is now the display order so a user drag
    // actually changes the rendered position.
    const result = sortByBookmark(rooms, ['c', 'a']);
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('preserves the relative order of non-bookmarked rooms', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const result = sortByBookmark(rooms, ['b']);
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('ignores bookmark ids that do not match any room', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }];
    const result = sortByBookmark(rooms, ['nonexistent', 'b']);
    expect(result.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const snapshot = rooms.map((r) => r.id);
    sortByBookmark(rooms, ['c']);
    expect(rooms.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('roomBookmarks store', () => {
  // The exported singleton is shared; reset between tests so order is independent.
  function clear() {
    for (const id of [...roomBookmarks.ids]) roomBookmarks.remove(id);
  }

  it('toggle round-trips: add then remove', () => {
    clear();
    expect(roomBookmarks.has('room-1')).toBe(false);
    roomBookmarks.toggle('room-1');
    expect(roomBookmarks.has('room-1')).toBe(true);
    expect(roomBookmarks.ids).toContain('room-1');
    roomBookmarks.toggle('room-1');
    expect(roomBookmarks.has('room-1')).toBe(false);
    expect(roomBookmarks.ids).not.toContain('room-1');
  });

  it('move(from, to) reorders ids and persists for #155 drag-reorder', () => {
    clear();
    roomBookmarks.add('a');
    roomBookmarks.add('b');
    roomBookmarks.add('c');
    roomBookmarks.add('d');
    expect(roomBookmarks.ids).toEqual(['a', 'b', 'c', 'd']);

    // Drag 'd' to position 1: ['a', 'd', 'b', 'c']
    roomBookmarks.move(3, 1);
    expect(roomBookmarks.ids).toEqual(['a', 'd', 'b', 'c']);

    // Drag 'a' to the end: ['d', 'b', 'c', 'a']
    roomBookmarks.move(0, 3);
    expect(roomBookmarks.ids).toEqual(['d', 'b', 'c', 'a']);
  });

  it('move() ignores out-of-range and same-position arguments', () => {
    clear();
    roomBookmarks.add('a');
    roomBookmarks.add('b');
    const before = [...roomBookmarks.ids];
    roomBookmarks.move(-1, 0);
    roomBookmarks.move(0, -1);
    roomBookmarks.move(0, 5);
    roomBookmarks.move(1, 1);
    expect(roomBookmarks.ids).toEqual(before);
  });

  it('add is idempotent (no duplicates)', () => {
    clear();
    roomBookmarks.add('room-2');
    roomBookmarks.add('room-2');
    roomBookmarks.add('room-2');
    expect(roomBookmarks.ids.filter((id) => id === 'room-2')).toHaveLength(1);
  });

  it('add ignores empty / whitespace-only ids and trims', () => {
    clear();
    roomBookmarks.add('');
    roomBookmarks.add('   ');
    expect(roomBookmarks.ids).toEqual([]);
    roomBookmarks.add('  room-3  ');
    expect(roomBookmarks.ids).toEqual(['room-3']);
  });

  it('persists to localStorage when available', () => {
    clear();
    const store = new Map<string, string>();
    const stub = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size; }
    };
    const g = globalThis as unknown as { localStorage?: typeof stub };
    const prior = g.localStorage;
    g.localStorage = stub;
    try {
      roomBookmarks.add('room-a');
      roomBookmarks.add('room-b');
      const raw = store.get('ant-room-bookmarks');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual(['room-a', 'room-b']);
    } finally {
      clear();
      if (prior === undefined) delete g.localStorage;
      else g.localStorage = prior;
    }
  });

  it('rehydrates from localStorage on init()', () => {
    clear();
    const store = new Map<string, string>([
      ['ant-room-bookmarks', JSON.stringify(['hydrated-1', 'hydrated-2'])]
    ]);
    const stub = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size; }
    };
    const g = globalThis as unknown as { localStorage?: typeof stub };
    const prior = g.localStorage;
    g.localStorage = stub;
    try {
      // Confirm in-memory state starts empty, then init() pulls from storage.
      expect(roomBookmarks.ids).toEqual([]);
      roomBookmarks.init();
      expect(roomBookmarks.ids).toEqual(['hydrated-1', 'hydrated-2']);
    } finally {
      clear();
      if (prior === undefined) delete g.localStorage;
      else g.localStorage = prior;
    }
  });

  it('init() is safe to call when storage is malformed', () => {
    clear();
    const store = new Map<string, string>([
      ['ant-room-bookmarks', '{not-json']
    ]);
    const stub = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size; }
    };
    const g = globalThis as unknown as { localStorage?: typeof stub };
    const prior = g.localStorage;
    g.localStorage = stub;
    try {
      expect(() => roomBookmarks.init()).not.toThrow();
      expect(roomBookmarks.ids).toEqual([]);
    } finally {
      clear();
      if (prior === undefined) delete g.localStorage;
      else g.localStorage = prior;
    }
  });
});
