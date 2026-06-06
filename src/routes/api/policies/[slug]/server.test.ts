import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';
import {
  createPolicy,
  listAuditForPolicy,
  resetPolicyStoreForTests,
  softDeletePolicy
} from '$lib/server/policyStore';
import { GET, PATCH, DELETE } from './+server';

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

let tmpDir: string;
const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
let actorCounter = 0;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-detail-route-'));
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

type Handler = (event: unknown) => unknown;

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

function event(
  slug: string,
  method: 'GET' | 'PATCH' | 'DELETE',
  cookieValue: string | null = null,
  body?: unknown
): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers.cookie = `ant_browser_session=${cookieValue}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return {
    params: { slug },
    request: new Request('http://x/api/policies/' + encodeURIComponent(slug), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
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

describe('/api/policies/:slug', () => {
  it('GET allows public reads, hides private rows from non-owners, and 404s missing rows', async () => {
    const publicPolicy = createPolicy({
      name: 'Public Policy',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'public'
    });
    const privatePolicy = createPolicy({
      name: 'Private Policy',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { secret: true },
      visibility: 'private'
    });

    const publicRes = await run(GET as unknown as Handler, event(publicPolicy.slug, 'GET'));
    expect(publicRes.status).toBe(200);
    await expect(publicRes.json()).resolves.toMatchObject({
      policy: { slug: publicPolicy.slug, name: 'Public Policy' }
    });

    const privateRes = await run(
      GET as unknown as Handler,
      event(privatePolicy.slug, 'GET', actorCookie('@other'))
    );
    expect(privateRes.status).toBe(403);

    const missingRes = await run(GET as unknown as Handler, event('missing-policy', 'GET'));
    expect(missingRes.status).toBe(404);
  });

  it('GET keeps soft-deleted rows visible to the owner but hidden from others', async () => {
    const policy = createPolicy({
      name: 'Deleted Policy',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });
    softDeletePolicy(policy.slug, '@you', 'human', 'cleanup');

    const ownerRes = await run(GET as unknown as Handler, event(policy.slug, 'GET', actorCookie('@you')));
    expect(ownerRes.status).toBe(200);
    await expect(ownerRes.json()).resolves.toMatchObject({
      policy: { slug: policy.slug, deletedAtMs: expect.any(Number) }
    });

    const otherRes = await run(GET as unknown as Handler, event(policy.slug, 'GET', actorCookie('@other')));
    expect(otherRes.status).toBe(404);
  });

  it('PATCH validates identity/ownership/body and writes update audit entries', async () => {
    const policy = createPolicy({
      name: 'Original',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });

    const noIdentity = await run(
      PATCH as unknown as Handler,
      event(policy.slug, 'PATCH', null, { name: 'Nope' })
    );
    expect(noIdentity.status).toBe(401);

    const other = await run(
      PATCH as unknown as Handler,
      event(policy.slug, 'PATCH', actorCookie('@other'), { name: 'Nope' })
    );
    expect(other.status).toBe(403);

    const invalid = await run(
      PATCH as unknown as Handler,
      event(policy.slug, 'PATCH', actorCookie('@you'), null)
    );
    expect(invalid.status).toBe(400);

    const res = await run(
      PATCH as unknown as Handler,
      event(policy.slug, 'PATCH', actorCookie('@you'), {
        name: 'Updated',
        description: 'new description',
        policy: { a: 2 },
        visibility: 'unlisted',
        reason: 'route test'
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      policy: {
        slug: policy.slug,
        name: 'Updated',
        description: 'new description',
        visibility: 'unlisted',
        policy: { a: 2 }
      }
    });
    expect(listAuditForPolicy(policy.id).map((entry) => entry.action)).toEqual([
      'visibility_change',
      'update',
      'create'
    ]);
  });

  it('DELETE is owner-gated, premium-gated, and soft-deletes with audit', async () => {
    const policy = createPolicy({
      name: 'Delete Me',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });

    const other = await run(
      DELETE as unknown as Handler,
      event(policy.slug, 'DELETE', actorCookie('@other'), {})
    );
    expect(other.status).toBe(403);

    featureGateState.verificationUxEnabled = false;
    const gated = await run(
      DELETE as unknown as Handler,
      event(policy.slug, 'DELETE', actorCookie('@you'), {})
    );
    expect(gated.status).toBe(402);
    featureGateState.verificationUxEnabled = true;

    const deleted = await run(
      DELETE as unknown as Handler,
      event(policy.slug, 'DELETE', actorCookie('@you'), { reason: 'obsolete' })
    );
    expect(deleted.status).toBe(204);
    expect(listAuditForPolicy(policy.id).map((entry) => entry.action)).toEqual([
      'soft_delete',
      'create'
    ]);

    const again = await run(
      DELETE as unknown as Handler,
      event(policy.slug, 'DELETE', actorCookie('@you'), {})
    );
    expect(again.status).toBe(404);
  });
});
