import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMcpGrant,
  listMcpGrantsForRoom,
  resetMcpGrantStoreForTests,
  revokeMcpGrant
} from './mcpGrantStore';
import { listActiveInvitesForRoom, resetChatInviteStoreForTests, verifyToken } from './chatInviteStore';

beforeEach(() => {
  resetChatInviteStoreForTests();
  resetMcpGrantStoreForTests();
});

afterEach(() => {
  resetMcpGrantStoreForTests();
  resetChatInviteStoreForTests();
});

describe('mcpGrantStore', () => {
  it('creates one mcp token with a creation-only secret and safe metadata', () => {
    const out = createMcpGrant({ roomId: 'room-a', handle: 'mcp', label: 'Claude Desktop', createdBy: '@op' });
    expect(out.tokenSecret).toMatch(/^[0-9a-f]+$/);
    expect(out.grant.token_id).toMatch(/^tok_/);
    expect(out.grant.invite_id).toMatch(/^inv_/);
    expect(out.grant.handle).toBe('@mcp');
    expect(out.grant.label).toBe('Claude Desktop');
    expect(out.grant.created_by).toBe('@op');
    expect((out.grant as unknown as { tokenSecret?: string; token_hash?: string; password_hash?: string }).tokenSecret).toBeUndefined();
    expect(verifyToken(out.tokenSecret, 'room-a')).toMatchObject({ kind: 'mcp', handle: '@mcp' });
    expect(listActiveInvitesForRoom('room-a')).toEqual([]);
  });

  it('lists mcp grant metadata without token bytes or hashes', () => {
    const out = createMcpGrant({ roomId: 'room-a', handle: '@mcp', label: 'Claude Code' });
    const listed = listMcpGrantsForRoom('room-a');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ token_id: out.grant.token_id, label: 'Claude Code', revoked_at: null });
    expect(JSON.stringify(listed[0])).not.toContain(out.tokenSecret);
    expect(JSON.stringify(listed[0])).not.toContain('hash');
    expect(listMcpGrantsForRoom('other-room')).toEqual([]);
  });

  it('allows duplicate handles when labels and token ids distinguish clients', () => {
    const a = createMcpGrant({ roomId: 'room-a', handle: '@mcp', label: 'Claude Desktop' });
    const b = createMcpGrant({ roomId: 'room-a', handle: '@mcp', label: 'Claude Code' });
    expect(a.grant.token_id).not.toBe(b.grant.token_id);
    expect(a.grant.label).not.toBe(b.grant.label);
    expect(listMcpGrantsForRoom('room-a').map((g) => [g.handle, g.label])).toEqual([
      ['@mcp', 'Claude Desktop'],
      ['@mcp', 'Claude Code']
    ]);
  });

  it('revoke invalidates the token and backing invite while preserving safe audit metadata', () => {
    const out = createMcpGrant({ roomId: 'room-a', handle: '@mcp', label: 'Claude Desktop' });
    expect(verifyToken(out.tokenSecret, 'room-a')).not.toBeNull();
    expect(revokeMcpGrant(out.grant.token_id)).toMatchObject({ revoked: true });
    expect(verifyToken(out.tokenSecret, 'room-a')).toBeNull();
    expect(listMcpGrantsForRoom('room-a')).toEqual([]);
    const revoked = listMcpGrantsForRoom('room-a', { includeRevoked: true });
    expect(revoked[0]).toMatchObject({ token_id: out.grant.token_id, revoked_at: expect.any(String) });
    expect(JSON.stringify(revoked[0])).not.toContain(out.tokenSecret);
  });

  it('revoke is idempotent for known tokens and false for unknown tokens', () => {
    const out = createMcpGrant({ roomId: 'room-a', handle: '@mcp' });
    expect(revokeMcpGrant(out.grant.token_id)).toMatchObject({ revoked: true });
    expect(revokeMcpGrant(out.grant.token_id)).toMatchObject({ revoked: true });
    expect(revokeMcpGrant('tok_missing')).toMatchObject({ revoked: false });
  });
});
