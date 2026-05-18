import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/server/db.js', () => ({
  queries: {
    getRoomToken: vi.fn(),
    getRoomInvite: vi.fn(),
  },
}));

vi.mock('../src/lib/server/room-invites.js', () => ({
  resolveToken: vi.fn(),
}));

import { queries } from '../src/lib/server/db.js';
import { resolveToken } from '../src/lib/server/room-invites.js';
import {
  deckCookieName,
  createDeckCookie,
  verifyDeckCookieValue,
  hasDeckCookie,
  issueDeckCookie,
  validateDeckInviteToken,
} from '../src/lib/server/deck-view-auth.js';

const MASTER_SECRET = 'deck-secret-42';

describe('deck-view-auth', () => {
  beforeEach(() => {
    process.env.ANT_DECK_COOKIE_SECRET = MASTER_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.ANT_DECK_COOKIE_SECRET;
    delete process.env.ANT_API_KEY;
  });

  describe('deckCookieName', () => {
    it('prefixes slug with ant-deck-', () => {
      expect(deckCookieName('hello')).toBe('ant-deck-hello');
    });

    it('sanitises unsafe characters to hyphens', () => {
      expect(deckCookieName('a/b@c')).toBe('ant-deck-a-b-c');
    });

    it('preserves dots and underscores', () => {
      expect(deckCookieName('v2_3.beta')).toBe('ant-deck-v2_3.beta');
    });
  });

  describe('createDeckCookie', () => {
    it('returns a dot-separated value with tokenId, expiresAt, and signature', () => {
      const now = 1_000_000;
      const result = createDeckCookie('my-deck', 'tok-1', now);
      const parts = result.value.split('.');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('tok-1');
      expect(Number(parts[1])).toBe(now + 12 * 60 * 60 * 1000);
      expect(parts[2]).toBeTruthy();
      expect(result.expiresAtMs).toBe(now + 12 * 60 * 60 * 1000);
    });

    it('produces different signatures for different slugs', () => {
      const a = createDeckCookie('deck-a', 'tok-1');
      const b = createDeckCookie('deck-b', 'tok-1');
      expect(a.value).not.toBe(b.value);
    });

    it('produces different signatures for different tokenIds', () => {
      const a = createDeckCookie('deck', 'tok-1');
      const b = createDeckCookie('deck', 'tok-2');
      expect(a.value).not.toBe(b.value);
    });

    it('uses default Date.now when now is omitted', () => {
      const before = Date.now();
      const result = createDeckCookie('deck', 'tok-1');
      const after = Date.now();
      expect(result.expiresAtMs).toBeGreaterThanOrEqual(before + 12 * 60 * 60 * 1000);
      expect(result.expiresAtMs).toBeLessThanOrEqual(after + 12 * 60 * 60 * 1000);
    });
  });

  describe('verifyDeckCookieValue', () => {
    it('returns true for a freshly created cookie', () => {
      (queries.getRoomToken as any).mockReturnValue({
        id: 'tok-1',
        room_id: 'r1',
        invite_id: 'inv-1',
        revoked_at: null,
      });
      (queries.getRoomInvite as any).mockReturnValue({ id: 'inv-1', revoked_at: null });

      const now = 1_000_000;
      const cookie = createDeckCookie('my-deck', 'tok-1', now);
      const deck = { allowed_room_ids: ['r1'] } as any;
      expect(verifyDeckCookieValue('my-deck', deck, cookie.value, now)).toBe(true);
    });

    it('returns false for missing value', () => {
      expect(verifyDeckCookieValue('deck', { allowed_room_ids: [] } as any, undefined)).toBe(false);
    });

    it('returns false when expired', () => {
      const now = 1_000_000;
      const cookie = createDeckCookie('deck', 'tok-1', now);
      expect(verifyDeckCookieValue('deck', { allowed_room_ids: [] } as any, cookie.value, now + 13 * 60 * 60 * 1000)).toBe(false);
    });

    it('returns false when signature is tampered', () => {
      const now = 1_000_000;
      const cookie = createDeckCookie('deck', 'tok-1', now);
      const tampered = cookie.value.slice(0, -4) + 'XXXX';
      expect(verifyDeckCookieValue('deck', { allowed_room_ids: [] } as any, tampered, now)).toBe(false);
    });

    it('returns false when token is revoked', () => {
      (queries.getRoomToken as any).mockReturnValue({
        id: 'tok-1',
        room_id: 'r1',
        invite_id: 'inv-1',
        revoked_at: new Date().toISOString(),
      });
      const now = 1_000_000;
      const cookie = createDeckCookie('deck', 'tok-1', now);
      const deck = { allowed_room_ids: ['r1'] } as any;
      expect(verifyDeckCookieValue('deck', deck, cookie.value, now)).toBe(false);
    });

    it('returns false when room is not allowed', () => {
      (queries.getRoomToken as any).mockReturnValue({
        id: 'tok-1',
        room_id: 'r2',
        invite_id: 'inv-1',
        revoked_at: null,
      });
      const now = 1_000_000;
      const cookie = createDeckCookie('deck', 'tok-1', now);
      const deck = { allowed_room_ids: ['r1'] } as any;
      expect(verifyDeckCookieValue('deck', deck, cookie.value, now)).toBe(false);
    });

    it('returns false when invite is revoked', () => {
      (queries.getRoomToken as any).mockReturnValue({
        id: 'tok-1',
        room_id: 'r1',
        invite_id: 'inv-1',
        revoked_at: null,
      });
      (queries.getRoomInvite as any).mockReturnValue({ id: 'inv-1', revoked_at: new Date().toISOString() });
      const now = 1_000_000;
      const cookie = createDeckCookie('deck', 'tok-1', now);
      const deck = { allowed_room_ids: ['r1'] } as any;
      expect(verifyDeckCookieValue('deck', deck, cookie.value, now)).toBe(false);
    });

    it('returns false for malformed cookie (no dots)', () => {
      expect(verifyDeckCookieValue('deck', { allowed_room_ids: [] } as any, 'nope')).toBe(false);
    });
  });

  describe('hasDeckCookie', () => {
    it('returns true when cookie is present and valid', () => {
      (queries.getRoomToken as any).mockReturnValue({ id: 'tok-1', room_id: 'r1', invite_id: 'inv-1', revoked_at: null });
      (queries.getRoomInvite as any).mockReturnValue({ id: 'inv-1', revoked_at: null });
      const cookie = createDeckCookie('my-deck', 'tok-1');
      const cookies = { get: vi.fn(() => cookie.value) } as any;
      const deck = { allowed_room_ids: ['r1'] } as any;
      expect(hasDeckCookie(cookies, 'my-deck', deck)).toBe(true);
    });

    it('returns false when cookie is absent', () => {
      const cookies = { get: vi.fn(() => undefined) } as any;
      expect(hasDeckCookie(cookies, 'deck', { allowed_room_ids: [] } as any)).toBe(false);
    });
  });

  describe('issueDeckCookie', () => {
    it('sets cookie with correct path and httpOnly', () => {
      const cookies = { set: vi.fn() } as any;
      issueDeckCookie(cookies, 'my-deck', 'tok-1', new URL('https://example.com/deck/my-deck'));
      expect(cookies.set).toHaveBeenCalledWith(
        'ant-deck-my-deck',
        expect.stringContaining('tok-1'),
        expect.objectContaining({
          path: '/deck/my-deck',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          expires: expect.any(Date),
        })
      );
    });

    it('sets secure=false for http URL', () => {
      const cookies = { set: vi.fn() } as any;
      issueDeckCookie(cookies, 'my-deck', 'tok-1', new URL('http://example.com/deck/my-deck'));
      const opts = cookies.set.mock.calls[0][2];
      expect(opts.secure).toBe(false);
    });
  });

  describe('validateDeckInviteToken', () => {
    it('returns ok:true with tokenId for valid token', () => {
      (resolveToken as any).mockReturnValue({ token: { id: 'tok-1', room_id: 'r1' } });
      const result = validateDeckInviteToken('deck', { allowed_room_ids: ['r1'] } as any, 'valid-token');
      expect(result).toEqual({ ok: true, tokenId: 'tok-1' });
    });

    it('returns 401 when token cannot be resolved', () => {
      (resolveToken as any).mockReturnValue(null);
      const result = validateDeckInviteToken('deck', { allowed_room_ids: ['r1'] } as any, 'bad-token');
      expect(result).toEqual({ ok: false, status: 401, message: expect.stringContaining('Invalid') });
    });

    it('returns 403 when room is not allowed', () => {
      (resolveToken as any).mockReturnValue({ token: { id: 'tok-1', room_id: 'r2' } });
      const result = validateDeckInviteToken('deck', { allowed_room_ids: ['r1'] } as any, 'token');
      expect(result).toEqual({ ok: false, status: 403, message: expect.stringContaining('not authorised') });
    });
  });
});
