import { describe, expect, it, beforeEach } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  createShareLink,
  getShareLink,
  isLinkValid,
  incrementLinkAccess,
  revokeShareLink,
  listShareLinksForRoom,
} from './shareLinkStore';

describe('shareLinkStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    getIdentityDb();
  });

  it('creates and retrieves a share link', () => {
    const l = createShareLink({
      room_id: 'room-a',
      title: 'Public view',
      scope: 'messages',
      created_by: '@evolveantkimi',
      expires_at_ms: Date.now() + 60_000,
    });
    expect(l.token).toHaveLength(24);
    expect(l.room_id).toBe('room-a');
    expect(l.scope).toBe('messages');
    expect(l.revoked_at_ms).toBeNull();

    const found = getShareLink(l.token);
    expect(found?.title).toBe('Public view');
  });

  it('validates link state', () => {
    const active = createShareLink({ room_id: 'room-a', expires_at_ms: Date.now() + 60_000 });
    expect(isLinkValid(active)).toBe(true);

    const expired = createShareLink({ room_id: 'room-a', expires_at_ms: Date.now() - 1 });
    expect(isLinkValid(expired)).toBe(false);
  });

  it('increments access count', () => {
    const l = createShareLink({ room_id: 'room-a' });
    expect(l.access_count).toBe(0);

    const updated = incrementLinkAccess(l.token);
    expect(updated?.access_count).toBe(1);
    expect(updated?.last_accessed_ms).not.toBeNull();

    const invalid = incrementLinkAccess('nonexistent');
    expect(invalid).toBeNull();
  });

  it('revokes a link', () => {
    const l = createShareLink({ room_id: 'room-a' });
    expect(revokeShareLink(l.token)).toBe(true);
    expect(getShareLink(l.token)?.revoked_at_ms).not.toBeNull();
    expect(revokeShareLink('nonexistent')).toBe(false);
  });

  it('lists links for a room', () => {
    createShareLink({ room_id: 'room-a', scope: 'room' });
    createShareLink({ room_id: 'room-b', scope: 'messages' });
    expect(listShareLinksForRoom('room-a').length).toBeGreaterThanOrEqual(1);
    expect(listShareLinksForRoom('room-b').length).toBeGreaterThanOrEqual(1);
  });
});
