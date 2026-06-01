import { describe, expect, it } from 'vitest';
import { sortByBookmark, visibleBookmarkedRooms } from './roomBookmarks.svelte';

describe('roomBookmarks sortByBookmark', () => {
  it('returns empty for empty input', () => {
    expect(sortByBookmark([], [])).toEqual([]);
  });

  it('places bookmarked rooms first in bookmark order', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(sortByBookmark(rooms, ['b', 'a'])).toEqual([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
  });

  it('drops missing bookmark ids silently', () => {
    const rooms = [{ id: 'a' }];
    expect(sortByBookmark(rooms, ['missing', 'a'])).toEqual([{ id: 'a' }]);
  });

  it('preserves non-bookmarked room order', () => {
    const rooms = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(sortByBookmark(rooms, ['y'])).toEqual([{ id: 'y' }, { id: 'x' }, { id: 'z' }]);
  });

  it('does not mutate input', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }];
    const original = [...rooms];
    sortByBookmark(rooms, ['b']);
    expect(rooms).toEqual(original);
  });

  it('handles all-bookmarked', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }];
    expect(sortByBookmark(rooms, ['b', 'a'])).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('handles no bookmarks', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }];
    expect(sortByBookmark(rooms, [])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('returns only visible bookmarked rooms without backfilling stale ids', () => {
    const rooms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(visibleBookmarkedRooms(rooms, ['missing', 'b'])).toEqual([{ id: 'b' }]);
  });
});
