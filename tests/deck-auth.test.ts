import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isDeckAdmin, assertDeckAccess, currentRoomId, requireDeckCaller } from '../src/lib/server/deck-auth.js';

const MASTER_KEY = 'master-key-123';

function makeEvent(overrides?: Partial<any>): any {
  const headers = new Map<string, string>();
  const searchParams = new Map<string, string>();

  if (overrides?.authorization) headers.set('authorization', overrides.authorization);
  if (overrides?.['x-api-key']) headers.set('x-api-key', overrides['x-api-key']);
  if (overrides?.apiKey) searchParams.set('apiKey', overrides.apiKey);

  return {
    request: {
      headers: { get: (k: string) => headers.get(k.toLowerCase()) || null },
    },
    url: { searchParams: { get: (k: string) => searchParams.get(k) || null } },
    locals: overrides?.locals ?? {},
  };
}

function makeDeck(roomIds: string[]): any {
  return { allowed_room_ids: roomIds };
}

function expectThrowsStatus(fn: () => void, expectedStatus: number) {
  try {
    fn();
    throw new Error(`Expected function to throw, but it did not`);
  } catch (err: any) {
    expect(err.status).toBe(expectedStatus);
  }
}

describe('deck-auth', () => {
  beforeEach(() => {
    process.env.ANT_API_KEY = MASTER_KEY;
  });

  afterEach(() => {
    delete process.env.ANT_API_KEY;
  });

  describe('isDeckAdmin', () => {
    it('returns true when Bearer token matches ANT_API_KEY', () => {
      expect(isDeckAdmin(makeEvent({ authorization: 'Bearer master-key-123' }))).toBe(true);
    });

    it('returns true when x-api-key header matches', () => {
      expect(isDeckAdmin(makeEvent({ 'x-api-key': 'master-key-123' }))).toBe(true);
    });

    it('returns true when apiKey query param matches', () => {
      expect(isDeckAdmin(makeEvent({ apiKey: 'master-key-123' }))).toBe(true);
    });

    it('returns false when no key is presented', () => {
      expect(isDeckAdmin(makeEvent())).toBe(false);
    });

    it('returns false when key does not match', () => {
      expect(isDeckAdmin(makeEvent({ authorization: 'Bearer wrong-key' }))).toBe(false);
    });

    it('returns false when ANT_API_KEY is unset', () => {
      delete process.env.ANT_API_KEY;
      expect(isDeckAdmin(makeEvent({ authorization: 'Bearer master-key-123' }))).toBe(false);
    });
  });

  describe('assertDeckAccess', () => {
    it('passes for admin with any deck', () => {
      expect(() => assertDeckAccess(makeEvent({ authorization: 'Bearer master-key-123' }), makeDeck([]))).not.toThrow();
    });

    it('throws 401 when no scope and not admin', () => {
      expectThrowsStatus(() => assertDeckAccess(makeEvent(), makeDeck(['r1'])), 401);
    });

    it('throws 403 when scope room is not in allowed list', () => {
      expectThrowsStatus(() =>
        assertDeckAccess(makeEvent({ locals: { roomScope: { roomId: 'r2' } } }), makeDeck(['r1'])),
        403
      );
    });

    it('passes when scope room is in allowed list', () => {
      expect(() =>
        assertDeckAccess(makeEvent({ locals: { roomScope: { roomId: 'r1' } } }), makeDeck(['r1']))
      ).not.toThrow();
    });

    it('throws 403 on write when kind is read-only (web)', () => {
      expectThrowsStatus(() =>
        assertDeckAccess(
          makeEvent({ locals: { roomScope: { roomId: 'r1', kind: 'web' } } }),
          makeDeck(['r1']),
          { write: true }
        ),
        403
      );
    });

    it('passes write when kind is cli', () => {
      expect(() =>
        assertDeckAccess(
          makeEvent({ locals: { roomScope: { roomId: 'r1', kind: 'cli' } } }),
          makeDeck(['r1']),
          { write: true }
        )
      ).not.toThrow();
    });
  });

  describe('currentRoomId', () => {
    it('returns null for admin', () => {
      expect(currentRoomId(makeEvent({ authorization: 'Bearer master-key-123' }))).toBeNull();
    });

    it('returns roomId for scoped caller', () => {
      expect(currentRoomId(makeEvent({ locals: { roomScope: { roomId: 'r1' } } }))).toBe('r1');
    });

    it('returns null when no scope and not admin', () => {
      expect(currentRoomId(makeEvent())).toBeNull();
    });
  });

  describe('requireDeckCaller', () => {
    it('returns admin:true for master key', () => {
      const result = requireDeckCaller(makeEvent({ authorization: 'Bearer master-key-123' }));
      expect(result).toEqual({ admin: true, scope: null });
    });

    it('returns admin:false with scope for room token', () => {
      const result = requireDeckCaller(makeEvent({ locals: { roomScope: { roomId: 'r1', kind: 'cli' } } }));
      expect(result).toEqual({ admin: false, scope: { roomId: 'r1', kind: 'cli' } });
    });

    it('throws 401 when no scope and not admin', () => {
      expectThrowsStatus(() => requireDeckCaller(makeEvent()), 401);
    });
  });
});
