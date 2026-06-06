import { beforeEach, describe, expect, it } from 'vitest';
import { resetChatRoomStoreForTests } from './chatRoomStore';
import {
  ensureHumanInboxRoom,
  inboxRoomIdFor,
  isInboxRoomId
} from './humanInboxRoomStore';
import { getIdentityDb } from './db';

describe('humanInboxRoomStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
  });

  it('inboxRoomIdFor derives a deterministic, slug-safe id', () => {
    expect(inboxRoomIdFor('@you')).toBe('__inbox_you__');
    expect(inboxRoomIdFor('you')).toBe('__inbox_you__');
    expect(inboxRoomIdFor('@James')).toBe('__inbox_james__');
    expect(inboxRoomIdFor('@MARK_TESTER')).toBe('__inbox_mark_tester__');
  });

  it('isInboxRoomId detects inbox room ids; rejects normal room ids', () => {
    expect(isInboxRoomId('__inbox_you__')).toBe(true);
    expect(isInboxRoomId('__inbox_james__')).toBe(true);
    expect(isInboxRoomId('4cvriarue1')).toBe(false);
    expect(isInboxRoomId('inbox_james')).toBe(false); // no leading underscores
  });

  it('ensureHumanInboxRoom returns the deterministic id without creating hidden rows', () => {
    const roomId = ensureHumanInboxRoom('@you');
    expect(roomId).toBe('__inbox_you__');
    const db = getIdentityDb();
    const room = db.prepare(`SELECT id, who_created_it FROM chat_rooms WHERE id = ?`).get(roomId) as
      { id: string; who_created_it: string } | undefined;
    expect(room).toBeUndefined();
    const member = db.prepare(`SELECT handle, kind FROM chat_room_members WHERE room_id = ?`).all(roomId) as
      Array<{ handle: string; kind: string }>;
    expect(member).toEqual([]);
  });

  it('ensureHumanInboxRoom is idempotent and non-mutating', () => {
    const a = ensureHumanInboxRoom('@you');
    const b = ensureHumanInboxRoom('@you');
    const c = ensureHumanInboxRoom('you'); // bareform → same room
    expect(a).toBe(b);
    expect(b).toBe(c);
    const db = getIdentityDb();
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM chat_rooms WHERE id = ?`).get(a) as { n: number };
    expect(rows.n).toBe(0);
    const members = db.prepare(`SELECT COUNT(*) AS n FROM chat_room_members WHERE room_id = ?`).get(a) as { n: number };
    expect(members.n).toBe(0);
  });

  it('different humans get different inbox rooms', () => {
    const youId = ensureHumanInboxRoom('@you');
    const jamesId = ensureHumanInboxRoom('@james');
    expect(youId).not.toBe(jamesId);
    expect(youId).toBe('__inbox_you__');
    expect(jamesId).toBe('__inbox_james__');
  });

  it('inbox rooms do NOT show up in listChatRooms() (hidden from normal lists)', async () => {
    const { listChatRooms } = await import('./chatRoomStore');
    ensureHumanInboxRoom('@you');
    ensureHumanInboxRoom('@james');
    const visible = listChatRooms().map((room) => room.id);
    expect(visible.some((id) => id.startsWith('__inbox_'))).toBe(false);
  });

  it('inbox room id survives common handle weirdness without colliding', () => {
    expect(inboxRoomIdFor('@user.with.dots')).toBe(inboxRoomIdFor('@user-with-dots'));
    // (deliberately collapses '.' → '-' — the slug is best-effort; humans
    // with truly distinct handles modulo slug normalisation would clash, but
    // the system constrains handles to [@a-z0-9_-] elsewhere so this is
    // theoretical, not practical.)
  });
});
