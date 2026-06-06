import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  enterFocus,
  exitFocus,
  findFocus,
  listFocusedMembersInRoom,
  listLapsedUnpromptedShields,
  markTimerPrompted,
  resetFocusModeStoreForTests,
  FOCUS_REASON_MAX_LENGTH
} from './focusModeStore';

describe('focusModeStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetFocusModeStoreForTests();
  });

  it('enterFocus saves the entry and surfaces it via findFocus', () => {
    const room = createChatRoom({ name: 'focus-target', whoCreatedIt: '@you' });
    const entry = enterFocus({
      roomId: room.id,
      memberHandle: '@you',
      reason: 'writing PR description'
    });
    expect(entry.memberHandle).toBe('@you');
    expect(entry.reason).toBe('writing PR description');
    expect(findFocus(room.id, '@you')?.reason).toBe('writing PR description');
  });

  it('enterFocus accepts an undefined reason and keeps reason undefined', () => {
    const room = createChatRoom({ name: 'no-reason', whoCreatedIt: '@you' });
    const entry = enterFocus({ roomId: room.id, memberHandle: '@you' });
    expect(entry.reason).toBeUndefined();
  });

  it('trims surrounding whitespace from the reason', () => {
    const room = createChatRoom({ name: 'trim', whoCreatedIt: '@you' });
    const entry = enterFocus({
      roomId: room.id,
      memberHandle: '@you',
      reason: '   deep review   '
    });
    expect(entry.reason).toBe('deep review');
  });

  it('treats a whitespace-only reason as undefined', () => {
    const room = createChatRoom({ name: 'blank-reason', whoCreatedIt: '@you' });
    const entry = enterFocus({
      roomId: room.id,
      memberHandle: '@you',
      reason: '    '
    });
    expect(entry.reason).toBeUndefined();
  });

  it('rejects a reason longer than the cap with no mutation', () => {
    const room = createChatRoom({ name: 'long-reason', whoCreatedIt: '@you' });
    const tooLong = 'x'.repeat(FOCUS_REASON_MAX_LENGTH + 1);
    expect(() =>
      enterFocus({ roomId: room.id, memberHandle: '@you', reason: tooLong })
    ).toThrow(/characters or fewer/);
    expect(findFocus(room.id, '@you')).toBeUndefined();
  });

  it('rejects an unknown room BEFORE the blank-handle check', () => {
    expect(() =>
      enterFocus({ roomId: 'doesnotexist', memberHandle: '   ', reason: 'x' })
    ).toThrow(/No room found/);
  });

  it('rejects a blank memberHandle', () => {
    const room = createChatRoom({ name: 'blank-handle', whoCreatedIt: '@you' });
    expect(() =>
      enterFocus({ roomId: room.id, memberHandle: '   ' })
    ).toThrow(/memberHandle/);
  });

  it('rejects a handle that is not a member of the room', () => {
    const room = createChatRoom({ name: 'nonmember', whoCreatedIt: '@you' });
    expect(() =>
      enterFocus({ roomId: room.id, memberHandle: '@stranger' })
    ).toThrow(/not a member/);
  });

  it('replaces an existing entry idempotently for the same (roomId, memberHandle)', () => {
    const room = createChatRoom({ name: 'replace', whoCreatedIt: '@you' });
    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'first' });
    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'second' });
    expect(findFocus(room.id, '@you')?.reason).toBe('second');
    expect(listFocusedMembersInRoom(room.id)).toHaveLength(1);
  });

  it('isolates focus entries per-member in the same room', () => {
    const room = createChatRoom({ name: 'per-member', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'mine' });
    enterFocus({ roomId: room.id, memberHandle: '@codex', reason: 'theirs' });
    expect(findFocus(room.id, '@you')?.reason).toBe('mine');
    expect(findFocus(room.id, '@codex')?.reason).toBe('theirs');
  });

  it('isolates focus entries per-room for the same member', () => {
    const roomA = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    enterFocus({ roomId: roomA.id, memberHandle: '@you', reason: 'A focus' });
    enterFocus({ roomId: roomB.id, memberHandle: '@you', reason: 'B focus' });
    expect(findFocus(roomA.id, '@you')?.reason).toBe('A focus');
    expect(findFocus(roomB.id, '@you')?.reason).toBe('B focus');
  });

  it('exitFocus reports prior existence and removes the entry', () => {
    const room = createChatRoom({ name: 'exit', whoCreatedIt: '@you' });
    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'going' });
    expect(exitFocus({ roomId: room.id, memberHandle: '@you' })).toBe(true);
    expect(findFocus(room.id, '@you')).toBeUndefined();
    expect(exitFocus({ roomId: room.id, memberHandle: '@you' })).toBe(false);
  });

  it('exitFocus rejects a blank memberHandle', () => {
    const room = createChatRoom({ name: 'exit-blank', whoCreatedIt: '@you' });
    expect(() =>
      exitFocus({ roomId: room.id, memberHandle: '   ' })
    ).toThrow(/memberHandle/);
  });

  it('listFocusedMembersInRoom returns every entry oldest first', async () => {
    const room = createChatRoom({ name: 'list', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });

    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    enterFocus({ roomId: room.id, memberHandle: '@a', reason: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    enterFocus({ roomId: room.id, memberHandle: '@b', reason: 'third' });

    const entries = listFocusedMembersInRoom(room.id);
    expect(entries).toHaveLength(3);
    expect(entries[0].memberHandle).toBe('@you');
    expect(entries[1].memberHandle).toBe('@a');
    expect(entries[2].memberHandle).toBe('@b');
  });

  it('reset clears every entry across rooms and members', () => {
    const room = createChatRoom({ name: 'reset', whoCreatedIt: '@you' });
    enterFocus({ roomId: room.id, memberHandle: '@you', reason: 'wiped' });
    resetFocusModeStoreForTests();
    expect(findFocus(room.id, '@you')).toBeUndefined();
    expect(listFocusedMembersInRoom(room.id)).toEqual([]);
  });

  // FOCUS-DURATION (2026-05-15, JWPK):
  describe('expiresAt / durationMs', () => {
    it('default (no durationMs) stamps expiresAt = null = indefinite', () => {
      const room = createChatRoom({ name: 'indef', whoCreatedIt: '@you' });
      const entry = enterFocus({ roomId: room.id, memberHandle: '@you' });
      expect(entry.expiresAt).toBeNull();
      // Survives any reads in the future since it never expires.
      expect(findFocus(room.id, '@you')).toEqual(entry);
      expect(listFocusedMembersInRoom(room.id)).toEqual([entry]);
    });

    it('durationMs sets expiresAt at (now + durationMs)', () => {
      const room = createChatRoom({ name: 'with-duration', whoCreatedIt: '@you' });
      const before = Date.now();
      const entry = enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: 60_000 });
      const after = Date.now();
      expect(entry.expiresAt).not.toBeNull();
      const expiresAtMs = new Date(entry.expiresAt!).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 60_000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 60_000);
    });

    it('rejects non-positive durationMs', () => {
      const room = createChatRoom({ name: 'bad-duration', whoCreatedIt: '@you' });
      expect(() => enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: 0 })).toThrow(/positive/);
      expect(() => enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: -1 })).toThrow(/positive/);
    });

    it('rejects non-finite durationMs', () => {
      const room = createChatRoom({ name: 'nan-duration', whoCreatedIt: '@you' });
      expect(() => enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: NaN })).toThrow(/positive/);
      expect(() => enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: Infinity })).toThrow(/positive/);
    });

    it('STAY-SHIELDED: findFocus still returns a focus whose timer has lapsed (no auto-prune)', () => {
      const room = createChatRoom({ name: 'find-expired', whoCreatedIt: '@you' });
      // 1ms timer; sleep past it. New model: the focus STAYS active (still
      // shielding); the lapse triggers a setter prompt, never auto-release.
      enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: 1 });
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(findFocus(room.id, '@you')).toBeDefined();
          expect(listFocusedMembersInRoom(room.id)).toHaveLength(1);
          resolve();
        }, 5);
      });
    });

    it('STAY-SHIELDED: listFocusedMembersInRoom keeps lapsed shields alongside live ones', () => {
      const room = createChatRoom({ name: 'mixed', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@live' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@stale' });
      enterFocus({ roomId: room.id, memberHandle: '@you' });
      enterFocus({ roomId: room.id, memberHandle: '@live' });
      enterFocus({ roomId: room.id, memberHandle: '@stale', durationMs: 1 });
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const handles = listFocusedMembersInRoom(room.id).map((e) => e.memberHandle);
          expect(handles).toEqual(expect.arrayContaining(['@you', '@live', '@stale']));
          expect(handles).toHaveLength(3); // @stale lapsed but STAYS shielded
          resolve();
        }, 5);
      });
    });

    it('listLapsedUnpromptedShields surfaces a lapsed shield once; markTimerPrompted silences it', () => {
      const room = createChatRoom({ name: 'lapsed-prompt', whoCreatedIt: '@you' });
      enterFocus({ roomId: room.id, memberHandle: '@you', durationMs: 1 });
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const lapsed = listLapsedUnpromptedShields(room.id);
          expect(lapsed.map((e) => e.memberHandle)).toEqual(['@you']);
          markTimerPrompted(room.id, '@you');
          // One-shot: already prompted → no longer surfaced.
          expect(listLapsedUnpromptedShields(room.id)).toHaveLength(0);
          // ...but the focus is STILL active (shielding) — only exitFocus clears it.
          expect(findFocus(room.id, '@you')).toBeDefined();
          resolve();
        }, 5);
      });
    });
  });
});
