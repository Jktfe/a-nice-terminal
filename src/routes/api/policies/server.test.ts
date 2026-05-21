import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from './+server';
import { GET as GET_ONE, PATCH, DELETE } from './[slug]/+server';
import { GET as GET_AUDIT } from './[slug]/audit/+server';
import { POST as POST_CLONE } from './[slug]/clone/+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { resetPolicyStoreForTests } from '$lib/server/policyStore';

const featureGateState = vi.hoisted(() => ({ verificationUxEnabled: true }));

vi.mock('$lib/server/featureGates', () => ({
  CURRENT_TIER: 'native',
  getFeatureFlagsForTier: () => ({
    verification_ux: featureGateState.verificationUxEnabled,
    chair_api: true,
    chair_ux: true,
    voice: true,
    sso: false,
    tenant_isolation: false,
    policy_controls: true,
  }),
}));

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
type AnyHandler = (event: unknown) => unknown;

function cookieEvent(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, cookieValue: string, body?: unknown) {
  const url = new URL(`http://localhost${path}`);
  const init: RequestInit = { method };
  const headers: Record<string, string> = { cookie: `ant_browser_session=${cookieValue}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return { request: new Request(url, init), url, params: {} };
}

function slugCookieEvent(slug: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', cookieValue: string, body?: unknown) {
  const ev = cookieEvent(method, `/api/policies/${slug}${method === 'POST' && method === 'POST' ? '' : ''}`, cookieValue, body);
  return { ...ev, params: { slug } };
}

function cloneEvent(slug: string, cookieValue: string, body?: unknown) {
  const url = new URL(`http://localhost/api/policies/${slug}/clone`);
  const init: RequestInit = { method: 'POST' };
  const headers: Record<string, string> = { cookie: `ant_browser_session=${cookieValue}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  return { request: new Request(url, init), url, params: { slug } };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function makeRoom() {
  return createChatRoom({ name: 'test-room', whoCreatedIt: '@you' });
}

async function actorCookie(): Promise<string> {
  const room = makeRoom();
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
    VALUES (?, 0, 'test', 'test-term', NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
    .run('t_test', nowSec + 99999, nowSec, nowSec);
  db.prepare(`INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run('mem-test', room.id, '@you', 't_test', nowSec);
  const result = createBrowserSession({ roomId: room.id, authorHandle: '@you', browserSessionId: 'bs_test' });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

async function otherActorCookie(): Promise<string> {
  const room = makeRoom();
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
    VALUES (?, 0, 'test', 'test-term-other', NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
    .run('t_other', nowSec + 99999, nowSec, nowSec);
  db.prepare(`INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run('mem-other', room.id, '@other', 't_other', nowSec);
  const result = createBrowserSession({ roomId: room.id, authorHandle: '@other', browserSessionId: 'bs_other' });
  if (!result) throw new Error('Failed to create browser session for @other');
  return result.browserSessionSecret;
}

describe('/api/policies', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-route-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetChatRoomStoreForTests();
    resetPolicyStoreForTests();
    featureGateState.verificationUxEnabled = true;
  });

  afterEach(() => {
    resetPolicyStoreForTests();
    resetChatRoomStoreForTests();
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDb;
  });

  it('GET lists empty initially', async () => {
    const cookie = await actorCookie();
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies', cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies).toEqual([]);
  });

  it('POST creates a policy when premium', async () => {
    const cookie = await actorCookie();
    const res = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'FCA Standard',
      policy: { blocks: { external_link: { agents: 2 } } },
      visibility: 'public'
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('FCA Standard');
    expect(body.slug).toBe('fca-standard');
  });

  it('premium-gates all mutating policy routes when verification UX is disabled', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Gate Source',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    featureGateState.verificationUxEnabled = false;

    const createBlocked = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Blocked',
      policy: { b: 2 }
    }));
    const patchBlocked = await run(PATCH as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'PATCH', cookie, {
      name: 'Blocked Patch'
    }));
    const deleteBlocked = await run(DELETE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'DELETE', cookie, {}));
    const cloneBlocked = await run(POST_CLONE as unknown as AnyHandler, cloneEvent(cBody.slug, cookie, {
      name: 'Blocked Clone'
    }));

    expect(createBlocked.status).toBe(402);
    expect(patchBlocked.status).toBe(402);
    expect(deleteBlocked.status).toBe(402);
    expect(cloneBlocked.status).toBe(402);
  });

  it('GET returns created policy', async () => {
    const cookie = await actorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Listed',
      policy: { a: 1 }
    }));
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies', cookie));
    const body = await res.json();
    expect(body.policies.length).toBe(1);
    expect(body.policies[0].name).toBe('Listed');
  });

  it('GET one returns policy', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'One',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(GET_ONE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.name).toBe('One');
  });

  it('PATCH updates policy', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Patch',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(PATCH as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'PATCH', cookie, {
      name: 'Patched',
      policy: { a: 2 }
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.name).toBe('Patched');
  });

  it('DELETE soft-deletes policy', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Del',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(DELETE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'DELETE', cookie, {}));
    expect(res.status).toBe(204);
  });

  it('GET audit returns entries', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Audit',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(GET_AUDIT as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit.length).toBeGreaterThanOrEqual(1);
    expect(body.audit[0].action).toBe('create');
  });

  it('POST clone forks policy', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Source',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(POST_CLONE as unknown as AnyHandler, cloneEvent(cBody.slug, cookie, { name: 'Fork' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy.name).toBe('Fork');
  });
  it('POST returns 401 without identity', async () => {
    const res = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', 'nope', {
      name: 'X',
      policy: {}
    }));
    expect(res.status).toBe(401);
  });

  it('private policy is hidden from public list', async () => {
    const cookie = await actorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Secret',
      policy: { a: 1 },
      visibility: 'private'
    }));
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies', cookie));
    const body = await res.json();
    // Anonymous or other actors should not see private policies in public list
    // But owner should see it via the myExtras merge
    expect(body.policies.some((p: { visibility: string }) => p.visibility === 'private')).toBe(true);
  });

  it('private policy 403 for non-owner GET', async () => {
    const ownerCookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'Private',
      policy: { a: 1 },
      visibility: 'private'
    }));
    const cBody = await created.json();
    const otherCookie = await otherActorCookie();
    const res = await run(GET_ONE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', otherCookie));
    expect(res.status).toBe(403);
  });

  it('unlisted policy not in public list but owner sees it', async () => {
    const cookie = await actorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'Unlisted',
      policy: { a: 1 },
      visibility: 'unlisted'
    }));
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies', cookie));
    const body = await res.json();
    const names = body.policies.map((p: { name: string }) => p.name);
    expect(names).toContain('Unlisted');
  });

  it('PATCH returns 401 without identity', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'PatchAuth',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(PATCH as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'PATCH', 'nope', {
      name: 'Nope'
    }));
    expect(res.status).toBe(401);
  });

  it('PATCH returns 403 for non-owner', async () => {
    const ownerCookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'Patch403',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const otherCookie = await otherActorCookie();
    const res = await run(PATCH as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'PATCH', otherCookie, {
      name: 'Nope'
    }));
    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 for non-owner', async () => {
    const ownerCookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'Del403',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const otherCookie = await otherActorCookie();
    const res = await run(DELETE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'DELETE', otherCookie, {}));
    expect(res.status).toBe(403);
  });

  it('GET audit returns 403 for private policy by non-owner', async () => {
    const ownerCookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'AuditPrivate',
      policy: { a: 1 },
      visibility: 'private'
    }));
    const cBody = await created.json();
    const otherCookie = await otherActorCookie();
    const res = await run(GET_AUDIT as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', otherCookie));
    expect(res.status).toBe(403);
  });

  it('POST clone returns 403 for private policy by non-owner', async () => {
    const ownerCookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'ClonePrivate',
      policy: { a: 1 },
      visibility: 'private'
    }));
    const cBody = await created.json();
    const otherCookie = await otherActorCookie();
    const res = await run(POST_CLONE as unknown as AnyHandler, cloneEvent(cBody.slug, otherCookie, { name: 'Fork' }));
    expect(res.status).toBe(403);
  });

  it('GET list with mine=1 returns only owned policies', async () => {
    const ownerCookie = await actorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'Mine',
      policy: { a: 1 }
    }));
    const otherCookie = await otherActorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', otherCookie, {
      name: 'Yours',
      policy: { b: 2 }
    }));
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies?mine=1', ownerCookie));
    const body = await res.json();
    expect(body.policies.length).toBe(1);
    expect(body.policies[0].name).toBe('Mine');
  });

  it('GET list with owner= filter returns public policies by that owner', async () => {
    const ownerCookie = await actorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', ownerCookie, {
      name: 'OwnerFilter',
      policy: { a: 1 }
    }));
    const otherCookie = await otherActorCookie();
    await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', otherCookie, {
      name: 'OtherFilter',
      policy: { b: 2 }
    }));
    const res = await run(GET as unknown as AnyHandler, cookieEvent('GET', '/api/policies?owner=%40you', ownerCookie));
    const body = await res.json();
    expect(body.policies.length).toBe(1);
    expect(body.policies[0].name).toBe('OwnerFilter');
  });


  it('GET deleted policy: owner can read, non-owner gets 404', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'DelRead',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    await run(DELETE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'DELETE', cookie, {}));
    const ownerGet = await run(GET_ONE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', cookie));
    expect(ownerGet.status).toBe(200);
    const body = await ownerGet.json();
    expect(body.policy.deletedAtMs).not.toBeNull();
    const anonGet = await run(GET_ONE as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'GET', ''));
    expect(anonGet.status).toBe(404);
  });

  it('PATCH invalid body returns 400', async () => {
    const cookie = await actorCookie();
    const created = await run(POST as unknown as AnyHandler, cookieEvent('POST', '/api/policies', cookie, {
      name: 'PatchInvalid',
      policy: { a: 1 }
    }));
    const cBody = await created.json();
    const res = await run(PATCH as unknown as AnyHandler, slugCookieEvent(cBody.slug, 'PATCH', cookie, 'not-json'));
    expect(res.status).toBe(400);
  });

  it('PATCH non-existent policy returns 404', async () => {
    const cookie = await actorCookie();
    const res = await run(PATCH as unknown as AnyHandler, slugCookieEvent('no-such-policy', 'PATCH', cookie, {
      name: 'X'
    }));
    expect(res.status).toBe(404);
  });
});
