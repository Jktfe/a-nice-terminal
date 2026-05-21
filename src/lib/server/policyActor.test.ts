import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolvePolicyActor } from './policyActor';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { addMembership } from './roomMembershipsStore';
import { createBrowserSession } from './browserSessionStore';

beforeEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
});

function makeRoom() {
  return createChatRoom({ name: 'test-room', whoCreatedIt: '@you' });
}

function cookieRequest(cookieValue: string) {
  return new Request('http://test.local/api/policies', {
    headers: { cookie: `ant_browser_session=${cookieValue}` }
  });
}

describe('resolvePolicyActor', () => {
  it('resolves by browser session cookie', () => {
    const room = makeRoom();
    const db = getIdentityDb();
    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
      VALUES (?, 0, 'test', 'test-term', NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
      .run('t_test', nowSec + 99999, nowSec, nowSec);
    addMembership({ room_id: room.id, handle: '@you', terminal_id: 't_test' });
    const result = createBrowserSession({ roomId: room.id, authorHandle: '@you' });
    if (!result) throw new Error('Failed to create browser session');

    const actor = resolvePolicyActor(cookieRequest(result.browserSessionSecret), null);
    expect(actor).toBeTruthy();
    expect(actor!.handle).toBe('@you');
    expect(actor!.kind).toBe('human');
  });

  it('returns null for invalid cookie', () => {
    const actor = resolvePolicyActor(cookieRequest('nope'), null);
    expect(actor).toBeNull();
  });

  it('returns null for no cookie and no pidChain', () => {
    const actor = resolvePolicyActor(new Request('http://test.local/api/policies'), null);
    expect(actor).toBeNull();
  });
});
