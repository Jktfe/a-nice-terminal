import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';
import { listAuditForPolicy, resetPolicyStoreForTests } from '$lib/server/policyStore';
import { JKS_VALIDATION_RULE_POLICY, JKS_VALIDATION_RULE_SLUG } from '$lib/server/validationPolicyPresets';

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
const previousDb = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

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

async function actorCookie(): Promise<string> {
  const operatorHandle = canonicaliseOperatorHandle('@you');
  const room = createChatRoom({ name: 'validation-room', whoCreatedIt: operatorHandle });
  const db = (await import('$lib/server/db')).getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR IGNORE INTO terminals (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
    VALUES (?, 0, 'test', 'test-term', NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`)
    .run('t_test', nowSec + 99999, nowSec, nowSec);
  db.prepare(`INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run('mem-test', room.id, operatorHandle, 't_test', nowSec);
  const result = createBrowserSession({ roomId: room.id, authorHandle: '@you', browserSessionId: 'bs_test' });
  if (!result) throw new Error('Failed to create browser session');
  return result.browserSessionSecret;
}

function eventFor(cookieValue: string) {
  const url = new URL('http://localhost/api/policies/presets/jks-validation-rule');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        cookie: `ant_browser_session=${cookieValue}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    }),
    url,
    params: {}
  };
}

describe('/api/policies/presets/jks-validation-rule', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-preset-route-'));
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

  it('seeds JKs rule once using policyStore audit semantics', async () => {
    const cookie = await actorCookie();

    const first = await run(POST as unknown as AnyHandler, eventFor(cookie));
    const firstBody = await first.json();
    const second = await run(POST as unknown as AnyHandler, eventFor(cookie));
    const secondBody = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(firstBody.policy.slug).toBe(JKS_VALIDATION_RULE_SLUG);
    expect(firstBody.policy.policy).toEqual(JKS_VALIDATION_RULE_POLICY);
    expect(secondBody.policy.id).toBe(firstBody.policy.id);
    expect(listAuditForPolicy(firstBody.policy.id).map((entry) => entry.action)).toEqual(['create']);
  });

  it('premium-gates the preset seed endpoint', async () => {
    const cookie = await actorCookie();
    featureGateState.verificationUxEnabled = false;

    const response = await run(POST as unknown as AnyHandler, eventFor(cookie));

    expect(response.status).toBe(402);
  });
});
