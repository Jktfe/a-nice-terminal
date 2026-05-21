import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatInviteRevokedError,
  ChatInviteHandleNotAllowedError,
  MAX_FAILED_ATTEMPTS,
  createInvite,
  exchangePasswordForToken,
  getInvitePreview,
  hashPassword,
  hashToken,
  listActiveInvitesForRoom,
  mintTokenSecret,
  resetChatInviteStoreForTests,
  revokeInvite,
  revokeToken,
  verifyPassword,
  verifyToken
} from './chatInviteStore';

beforeEach(() => {
  resetChatInviteStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
});

function makeInvite(overrides: Partial<{ roomId: string; label: string; password: string; kinds: ('cli' | 'mcp' | 'web')[]; createdBy: string | null }> = {}) {
  return createInvite({
    roomId: overrides.roomId ?? 'room-a',
    label: overrides.label ?? 'Team invite',
    password: overrides.password ?? 'correct-horse-battery-staple',
    kinds: overrides.kinds ?? ['cli'],
    createdBy: overrides.createdBy ?? '@claude2'
  });
}

describe('chatInviteStore', () => {
  it('C1: createInvite returns invite with id/room_id/label/kinds and NEVER leaks password_hash', () => {
    const summary = makeInvite();
    expect(summary.id).toMatch(/^inv_/);
    expect(summary.room_id).toBe('room-a');
    expect(summary.label).toBe('Team invite');
    expect(summary.kinds).toEqual(['cli']);
    expect((summary as unknown as { password_hash?: string }).password_hash).toBeUndefined();
  });

  it('C2: createInvite rejects empty label / empty password / unknown kind', () => {
    expect(() => createInvite({ roomId: 'r', label: '', password: 'abcd', kinds: ['cli'] })).toThrow();
    expect(() => createInvite({ roomId: 'r', label: 'x', password: 'a', kinds: ['cli'] })).toThrow();
    expect(() => createInvite({ roomId: 'r', label: 'x', password: 'abcd', kinds: [] })).toThrow();
    expect(() => createInvite({ roomId: 'r', label: 'x', password: 'abcd', kinds: ['notreal' as 'cli'] })).toThrow();
  });

  it('C3: exchangePasswordForToken succeeds with right password and returns tokenId + tokenSecret', () => {
    const invite = makeInvite();
    const out = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli', handle: '@guest' });
    expect(out.tokenId).toMatch(/^tok_/);
    expect(out.tokenSecret).toMatch(/^[0-9a-f]+$/);
    expect(out.tokenSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('C4: exchangePasswordForToken fails with wrong password and increments failed_attempts', () => {
    const invite = makeInvite();
    expect(() => exchangePasswordForToken({ inviteId: invite.id, password: 'WRONG', kind: 'cli' })).toThrow(ChatInviteRevokedError);
    // Right password still works after one failure (counter resets only on success)
    const out = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(out.tokenSecret.length).toBeGreaterThan(0);
  });

  it('C5: N consecutive failures auto-revoke the invite and cascade-revoke any tokens', () => {
    const invite = makeInvite();
    const first = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(verifyToken(first.tokenSecret, 'room-a')).not.toBeNull();
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      expect(() => exchangePasswordForToken({ inviteId: invite.id, password: 'WRONG', kind: 'cli' })).toThrow();
    }
    // After threshold, invite is revoked and the prior token is cascade-revoked
    expect(verifyToken(first.tokenSecret, 'room-a')).toBeNull();
    expect(() => exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' })).toThrow(ChatInviteRevokedError);
  });

  it('C6: verifyToken returns identity tuple on match; mismatched roomId returns null', () => {
    const invite = makeInvite({ roomId: 'room-a' });
    const out = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli', handle: '@guest' });
    const identity = verifyToken(out.tokenSecret, 'room-a');
    expect(identity).not.toBeNull();
    expect(identity?.tokenId).toBe(out.tokenId);
    expect(identity?.inviteId).toBe(invite.id);
    expect(identity?.kind).toBe('cli');
    expect(identity?.handle).toBe('@guest');
    expect(verifyToken(out.tokenSecret, 'OTHER-ROOM')).toBeNull();
  });

  it('C7: revoked token returns null', () => {
    const invite = makeInvite();
    const out = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(revokeToken(out.tokenId)).toBe(true);
    expect(verifyToken(out.tokenSecret, 'room-a')).toBeNull();
  });

  it('C8: revokeToken on one token does not affect another under the same invite', () => {
    const invite = makeInvite();
    const a = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    const b = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(revokeToken(a.tokenId)).toBe(true);
    expect(verifyToken(a.tokenSecret, 'room-a')).toBeNull();
    expect(verifyToken(b.tokenSecret, 'room-a')).not.toBeNull();
  });

  it('C9: revokeInvite cascades to all derived tokens', () => {
    const invite = makeInvite();
    const a = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    const b = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(revokeInvite(invite.id)).toBe(true);
    expect(verifyToken(a.tokenSecret, 'room-a')).toBeNull();
    expect(verifyToken(b.tokenSecret, 'room-a')).toBeNull();
  });

  it('C10: listActiveInvitesForRoom returns only non-revoked invites + safe summary', () => {
    const a = makeInvite({ roomId: 'room-a', label: 'A' });
    const b = makeInvite({ roomId: 'room-a', label: 'B' });
    makeInvite({ roomId: 'other-room', label: 'C' });
    revokeInvite(b.id);
    const active = listActiveInvitesForRoom('room-a');
    expect(active.map((entry) => entry.label)).toEqual(['A']);
    expect((active[0] as unknown as { password_hash?: string }).password_hash).toBeUndefined();
  });

  it('C11: hashPassword + verifyPassword roundtrip with salt randomness + timing-safe equal', () => {
    const a = hashPassword('hunter2-correct');
    const b = hashPassword('hunter2-correct');
    expect(a).not.toBe(b);
    expect(verifyPassword('hunter2-correct', a)).toBe(true);
    expect(verifyPassword('hunter2-correct', b)).toBe(true);
    expect(verifyPassword('WRONG', a)).toBe(false);
  });

  it('C12: mintTokenSecret returns unique values; hashToken roundtrip is stable', () => {
    const secrets = new Set<string>();
    for (let n = 0; n < 50; n++) secrets.add(mintTokenSecret());
    expect(secrets.size).toBe(50);
    const sample = mintTokenSecret();
    expect(hashToken(sample)).toBe(hashToken(sample));
    expect(hashToken(sample)).not.toBe(sample);
  });

  it('C13: repeated successful exchanges return different secrets (token rotation)', () => {
    const invite = makeInvite();
    const first = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    const second = exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'cli' });
    expect(first.tokenSecret).not.toBe(second.tokenSecret);
    expect(verifyToken(first.tokenSecret, 'room-a')).not.toBeNull();
    expect(verifyToken(second.tokenSecret, 'room-a')).not.toBeNull();
  });

  it('extra: exchange rejects kind not allowed by invite', () => {
    const invite = makeInvite({ kinds: ['cli'] });
    expect(() => exchangePasswordForToken({ inviteId: invite.id, password: 'correct-horse-battery-staple', kind: 'web' })).toThrow();
  });

  it('B1-regression: mutating the public summary kinds array cannot widen the stored invite', () => {
    const summary = makeInvite({ kinds: ['cli'] });
    (summary.kinds as ('cli' | 'mcp' | 'web')[]).push('web');
    expect(() => exchangePasswordForToken({ inviteId: summary.id, password: 'correct-horse-battery-staple', kind: 'web' })).toThrow();
    // listActiveInvitesForRoom result must also be defensively copied
    const listed = listActiveInvitesForRoom('room-a');
    expect(listed[0].kinds).toEqual(['cli']);
    (listed[0].kinds as ('cli' | 'mcp' | 'web')[]).push('mcp');
    const listedAgain = listActiveInvitesForRoom('room-a');
    expect(listedAgain[0].kinds).toEqual(['cli']);
  });
});

describe('B2-1 consent gate — invite allowlist (2026-05-15)', () => {
  it('no allowlist → open: any handle redeems with correct password', () => {
    const inv = createInvite({
      roomId: 'r', label: 'open', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you'
    });
    const out = exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@anyone'
    });
    expect(out.tokenId).toMatch(/^tok_/);
  });

  it('allowlisted handle + correct password → token minted', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gated', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: ['@alice', '@bob']
    });
    const out = exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@bob'
    });
    expect(out.tokenId).toMatch(/^tok_/);
  });

  it('password correct but handle NOT on allowlist → ChatInviteHandleNotAllowedError', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gated', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: ['@alice']
    });
    expect(() => exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@stranger'
    })).toThrow(ChatInviteHandleNotAllowedError);
  });

  it('allowlist set but NO handle supplied → rejected (consent requires identification)', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gated', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: ['@alice']
    });
    expect(() => exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: null
    })).toThrow(ChatInviteHandleNotAllowedError);
  });

  it('consent denial does NOT increment failed_attempts (not a brute-force)', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gated', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: ['@alice']
    });
    // Many consent-denied attempts must NOT auto-revoke the invite.
    for (let n = 0; n < MAX_FAILED_ATTEMPTS + 2; n++) {
      expect(() => exchangePasswordForToken({
        inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@stranger'
      })).toThrow(ChatInviteHandleNotAllowedError);
    }
    // Invite still usable for an allowed handle.
    const out = exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@alice'
    });
    expect(out.tokenId).toMatch(/^tok_/);
  });

  it('empty allowedHandles array → treated as open (normalized to null)', () => {
    const inv = createInvite({
      roomId: 'r', label: 'open', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: []
    });
    const out = exchangePasswordForToken({
      inviteId: inv.id, password: 'correct-horse-battery', kind: 'cli', handle: '@anyone'
    });
    expect(out.tokenId).toMatch(/^tok_/);
  });

  it('wrong password still 401-class (revoked error) regardless of allowlist', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gated', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you', allowedHandles: ['@alice']
    });
    expect(() => exchangePasswordForToken({
      inviteId: inv.id, password: 'wrong', kind: 'cli', handle: '@alice'
    })).toThrow(ChatInviteRevokedError);
  });
});

describe('B2-2-summary — getInvitePreview public preview (2026-05-15)', () => {
  it('returns inviteId/roomId/label/kindsAllowed/revoked, NO secret fields', () => {
    const inv = createInvite({
      roomId: 'room-x', label: 'Design review', password: 'correct-horse-battery',
      kinds: ['cli', 'web'], createdBy: '@you'
    });
    const p = getInvitePreview(inv.id);
    expect(p).toEqual({
      inviteId: inv.id, roomId: 'room-x', label: 'Design review',
      kindsAllowed: ['cli', 'web'], revoked: false
    });
    // Never leaks secret/internal fields.
    expect(p).not.toHaveProperty('password_hash');
    expect(p).not.toHaveProperty('failed_attempts');
    expect(p).not.toHaveProperty('allowed_handles');
  });

  it('reflects revoked state', () => {
    const inv = createInvite({
      roomId: 'r', label: 'gone', password: 'correct-horse-battery',
      kinds: ['cli'], createdBy: '@you'
    });
    revokeInvite(inv.id);
    expect(getInvitePreview(inv.id)?.revoked).toBe(true);
  });

  it('returns null for unknown invite id', () => {
    expect(getInvitePreview('inv_does_not_exist')).toBeNull();
  });
});
