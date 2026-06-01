import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import {
  createPolicy,
  listAuditForPolicy,
  resetPolicyStoreForTests,
  softDeletePolicy
} from '$lib/server/policyStore';
import { POST } from './+server';

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
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-clone-route-'));
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

function event(slug: string, cookieValue: string | null = null, body?: unknown): Parameters<typeof POST>[0] {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers.cookie = `ant_browser_session=${cookieValue}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return {
    params: { slug },
    request: new Request(`http://x/api/policies/${encodeURIComponent(slug)}/clone`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

function actorCookie(handle: string): string {
  actorCounter += 1;
  const room = createChatRoom({ name: `${handle} room`, whoCreatedIt: handle });
  const db = getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const terminalId = `t_${handle.replace(/[^a-z0-9]/gi, '_')}_${actorCounter}`;
  db.prepare(
    `INSERT OR IGNORE INTO terminals
      (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(
    terminalId,
    actorCounter,
    `test-${actorCounter}`,
    `${handle} terminal ${actorCounter}`,
    nowSec + 99999,
    nowSec,
    nowSec
  );
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem_${terminalId}`, room.id, handle, terminalId, nowSec);
  const result = createBrowserSession({
    roomId: room.id,
    authorHandle: handle,
    browserSessionId: `bs_${terminalId}`
  });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

describe('POST /api/policies/:slug/clone', () => {
  it('clones a readable policy under the caller and writes source/target audit rows', async () => {
    const source = createPolicy({
      name: 'Source Standard',
      ownerHandle: '@owner',
      actorKind: 'human',
      description: 'source description',
      policy: { checks: { links: 2 } },
      visibility: 'public'
    });

    const res = await run(
      POST as unknown as Handler,
      event(source.slug, actorCookie('@agent'), {
        name: 'Agent Fork',
        visibility: 'private',
        reason: 'route test'
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy).toMatchObject({
      name: 'Agent Fork',
      ownerHandle: '@agent',
      description: 'source description',
      policy: { checks: { links: 2 } },
      visibility: 'private'
    });
    expect(body.policy.slug).not.toBe(source.slug);

    expect(listAuditForPolicy(source.id).map((entry) => entry.action)).toContain('clone_source');
    expect(listAuditForPolicy(body.policy.id).map((entry) => entry.action)).toContain('clone_target');
  });

  it('premium-gates clone mutations before validating body or identity', async () => {
    const source = createPolicy({
      name: 'Gate Source',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });
    featureGateState.verificationUxEnabled = false;

    const res = await run(POST as unknown as Handler, event(source.slug, actorCookie('@you'), { name: 'Fork' }));

    expect(res.status).toBe(402);
  });

  it('validates JSON body, clone name, and identity', async () => {
    const source = createPolicy({
      name: 'Validation Source',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });

    const missingBody = await run(POST as unknown as Handler, event(source.slug, actorCookie('@you')));
    expect(missingBody.status).toBe(400);

    const missingName = await run(POST as unknown as Handler, event(source.slug, actorCookie('@you'), { name: ' ' }));
    expect(missingName.status).toBe(400);

    const missingIdentity = await run(POST as unknown as Handler, event(source.slug, null, { name: 'Fork' }));
    expect(missingIdentity.status).toBe(401);
  });

  it('rejects private sources for non-owners but lets the owner clone them', async () => {
    const source = createPolicy({
      name: 'Private Source',
      ownerHandle: '@owner',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'private'
    });

    const otherRes = await run(POST as unknown as Handler, event(source.slug, actorCookie('@other'), { name: 'Fork' }));
    expect(otherRes.status).toBe(403);

    const ownerRes = await run(POST as unknown as Handler, event(source.slug, actorCookie('@owner'), { name: 'Owner Fork' }));
    expect(ownerRes.status).toBe(201);
  });

  it('returns 404 for missing or deleted sources', async () => {
    const missing = await run(POST as unknown as Handler, event('missing-policy', actorCookie('@you'), { name: 'Fork' }));
    expect(missing.status).toBe(404);

    const source = createPolicy({
      name: 'Deleted Source',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 }
    });
    softDeletePolicy(source.slug, '@you', 'human');

    const deleted = await run(POST as unknown as Handler, event(source.slug, actorCookie('@you'), { name: 'Fork' }));
    expect(deleted.status).toBe(404);
  });

  it('defaults unsupported visibility values to public', async () => {
    const source = createPolicy({
      name: 'Visibility Source',
      ownerHandle: '@you',
      actorKind: 'human',
      policy: { a: 1 },
      visibility: 'unlisted'
    });

    const res = await run(
      POST as unknown as Handler,
      event(source.slug, actorCookie('@you'), { name: 'Default Visibility Fork', visibility: 'nonsense' })
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      policy: { visibility: 'public' }
    });
  });
});
