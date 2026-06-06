import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';
import {
  createPolicy,
  resetPolicyStoreForTests,
  softDeletePolicy,
  updatePolicy
} from '$lib/server/policyStore';
import { GET } from './+server';

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
    policy_controls: true
  })
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
let tmpDir: string;
let actorCounter = 0;

type Handler = (event: unknown) => unknown;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-audit-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetPolicyStoreForTests();
  featureGateState.verificationUxEnabled = true;
  actorCounter = 0;
});

afterEach(() => {
  resetPolicyStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

async function run(handler: Handler, event: unknown): Promise<Response> {
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

function event(slug: string, cookieValue: string | null = null): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers.cookie = `ant_browser_session=${cookieValue}`;
  return {
    params: { slug },
    request: new Request(`http://x/api/policies/${encodeURIComponent(slug)}/audit`, { headers })
  } as Parameters<typeof GET>[0];
}

function actorCookie(handle: string): string {
  actorCounter += 1;
  const storageHandle = canonicaliseOperatorHandle(handle);
  const room = createChatRoom({ name: `${handle} room`, whoCreatedIt: storageHandle });
  const db = getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const terminalId = `t_${storageHandle.replace(/[^a-z0-9]/gi, '_')}_${actorCounter}`;
  db.prepare(
    `INSERT OR IGNORE INTO terminals
      (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(
    terminalId,
    actorCounter,
    `test-${actorCounter}`,
    `${storageHandle} terminal ${actorCounter}`,
    nowSec + 99999,
    nowSec,
    nowSec
  );
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem_${terminalId}`, room.id, storageHandle, terminalId, nowSec);
  const result = createBrowserSession({
    roomId: room.id,
    authorHandle: handle,
    browserSessionId: `bs_${terminalId}`
  });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

describe('GET /api/policies/:slug/audit', () => {
  it('returns public audit entries for anonymous readers', async () => {
    const policy = createPolicy({
      name: 'Public Audit',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'public'
    });

    const res = await run(GET as unknown as Handler, event(policy.slug));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit).toEqual([
      expect.objectContaining({
        action: 'create',
        actorHandle: '@you',
        createdAtMs: expect.any(Number)
      })
    ]);
  });

  it('returns 404 for missing policies', async () => {
    const res = await run(GET as unknown as Handler, event('no-such-policy', actorCookie('@you')));

    expect(res.status).toBe(404);
  });

  it('hides private policy audit from non-owners', async () => {
    const policy = createPolicy({
      name: 'Private Audit',
      ownerHandle: '@owner',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'private'
    });

    const res = await run(GET as unknown as Handler, event(policy.slug, actorCookie('@other')));

    expect(res.status).toBe(403);
  });

  it('allows owners to read private policy audit', async () => {
    const policy = createPolicy({
      name: 'Private Owner Audit',
      ownerHandle: '@owner',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'private'
    });

    const res = await run(GET as unknown as Handler, event(policy.slug, actorCookie('@owner')));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      audit: [expect.objectContaining({ action: 'create', actorHandle: '@owner' })]
    });
  });

  it('hides deleted policy audit from non-owners but allows owners to read it', async () => {
    const policy = createPolicy({
      name: 'Deleted Audit',
      ownerHandle: '@owner',
      actorKind: 'human',
      policy: { a: 1 }
    });
    softDeletePolicy(policy.slug, '@owner', 'human', null);

    const anonRes = await run(GET as unknown as Handler, event(policy.slug));
    expect(anonRes.status).toBe(404);

    const ownerRes = await run(GET as unknown as Handler, event(policy.slug, actorCookie('@owner')));
    expect(ownerRes.status).toBe(200);
    const body = await ownerRes.json();
    expect(body.audit.map((entry: { action: string }) => entry.action)).toContain('soft_delete');
  });

  it('returns audit entries newest-first', async () => {
    const policy = createPolicy({
      name: 'Ordered Audit',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });
    updatePolicy({ slug: policy.slug, actorHandle: '@you', actorKind: 'human', name: 'First' });
    updatePolicy({ slug: policy.slug, actorHandle: '@you', actorKind: 'human', name: 'Second' });

    const res = await run(GET as unknown as Handler, event(policy.slug, actorCookie('@you')));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit.length).toBeGreaterThanOrEqual(3);
    const times = body.audit.map((entry: { createdAtMs: number }) => entry.createdAtMs);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });
});
