import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRoomMemberPreferences,
  setRoomMemberPreferences,
  listRoomMemberPreferencesForHandle,
  resetRoomMemberPreferencesStoreForTests
} from './roomMemberPreferencesStore';

// No FK constraint on room_member_preferences (deliberately — pref rows
// are UI-state, no orphan harm), so tests can use arbitrary roomIds
// without seeding chat_rooms.

beforeEach(() => {
  resetRoomMemberPreferencesStoreForTests();
});

describe('getRoomMemberPreferences', () => {
  it('returns all-false defaults for an absent row', () => {
    const prefs = getRoomMemberPreferences('room-a', '@viewer');
    expect(prefs).toEqual({
      roomId: 'room-a',
      handle: '@viewer',
      pinned: false,
      muted: false,
      archived: false,
      updatedAtMs: 0
    });
  });
});

describe('setRoomMemberPreferences', () => {
  it('writes a new row with the supplied flags', () => {
    const result = setRoomMemberPreferences({
      roomId: 'room-a', handle: '@viewer', pinned: true
    });
    expect(result.pinned).toBe(true);
    expect(result.muted).toBe(false);
    expect(result.archived).toBe(false);
    expect(result.updatedAtMs).toBeGreaterThan(0);
    const re = getRoomMemberPreferences('room-a', '@viewer');
    expect(re.pinned).toBe(true);
  });

  it('partial update preserves unspecified flags', () => {
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', pinned: true, muted: true });
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', archived: true });
    const final = getRoomMemberPreferences('room-a', '@v');
    expect(final).toMatchObject({ pinned: true, muted: true, archived: true });
  });

  it('explicit false clears a flag', () => {
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', pinned: true });
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', pinned: false });
    expect(getRoomMemberPreferences('room-a', '@v').pinned).toBe(false);
  });

  it('is idempotent — second identical call leaves state unchanged (only updated_at advances)', () => {
    const first = setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', muted: true });
    const second = setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', muted: true });
    expect(second.muted).toBe(true);
    expect(second.updatedAtMs).toBeGreaterThanOrEqual(first.updatedAtMs);
  });

  it('different viewers in the same room get independent rows', () => {
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@alice', pinned: true });
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@bob', muted: true });
    expect(getRoomMemberPreferences('room-a', '@alice')).toMatchObject({ pinned: true, muted: false });
    expect(getRoomMemberPreferences('room-a', '@bob')).toMatchObject({ pinned: false, muted: true });
  });

  it('same viewer across rooms gets independent rows', () => {
    setRoomMemberPreferences({ roomId: 'room-a', handle: '@v', pinned: true });
    setRoomMemberPreferences({ roomId: 'room-b', handle: '@v', archived: true });
    expect(getRoomMemberPreferences('room-a', '@v')).toMatchObject({ pinned: true, archived: false });
    expect(getRoomMemberPreferences('room-b', '@v')).toMatchObject({ pinned: false, archived: true });
  });

  it('rejects empty roomId / handle', () => {
    expect(() => setRoomMemberPreferences({ roomId: '', handle: '@v' })).toThrow(/roomId/);
    expect(() => setRoomMemberPreferences({ roomId: 'r', handle: '' })).toThrow(/handle/);
  });
});

describe('listRoomMemberPreferencesForHandle', () => {
  it('returns all rooms a viewer has explicit preferences in', () => {
    setRoomMemberPreferences({ roomId: 'r1', handle: '@v', pinned: true });
    setRoomMemberPreferences({ roomId: 'r2', handle: '@v', muted: true });
    setRoomMemberPreferences({ roomId: 'r3', handle: '@other', pinned: true });
    const list = listRoomMemberPreferencesForHandle('@v');
    expect(list.map((p) => p.roomId).sort()).toEqual(['r1', 'r2']);
    expect(list.find((p) => p.roomId === 'r1')?.pinned).toBe(true);
    expect(list.find((p) => p.roomId === 'r2')?.muted).toBe(true);
  });

  it('returns empty array when viewer has no preferences', () => {
    expect(listRoomMemberPreferencesForHandle('@nobody')).toEqual([]);
  });
});
