import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { canonicaliseOperatorHandle } from '$lib/server/operatorHandle';
import { getValidationSchema, listValidationSchemaAuditForSchema } from '$lib/server/validationLensStore';

const featureGateState = vi.hoisted(() => ({
  verificationUxEnabled: true,
  verificationAuthorEnabled: true
}));

vi.mock('$lib/server/featureGates', () => ({
  CURRENT_TIER: 'native',
  getFeatureFlagsForTier: () => ({
    verification_ux: featureGateState.verificationUxEnabled,
    verification_api: true,
    verification_author: featureGateState.verificationAuthorEnabled,
    policy_controls: true
  }),
  requireVerificationAuthorTier: () => {
    if (!featureGateState.verificationAuthorEnabled) {
      throw error(403, 'Verification authoring requires premium tier.');
    }
  }
}));

import { GET, POST } from './+server';
import { GET as GET_ONE, PATCH, DELETE } from './[lensId]/+server';
import { GET as GET_AUDIT } from './[lensId]/audit/+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
let tmpDir = '';
let actorCounter = 0;

type Handler = (event: unknown) => unknown;

const validRules = {
  version: 2,
  blocks: {
    claim_material: {
      mode: 'all',
      requirements: [
        { kind: 'agent', count: 2, specific: ['@speedyclaude'] },
        { kind: 'person', count: 1, specific: ['@james'] }
      ]
    },
    opinion: {
      mode: 'none',
      reason: 'Opinion claims are labelled but not independently verified.'
    }
  },
  fallback: {
    mode: 'any',
    requirements: [{ kind: 'agent', count: 1 }]
  }
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-verification-lenses-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  featureGateState.verificationUxEnabled = true;
  featureGateState.verificationAuthorEnabled = true;
  actorCounter = 0;
});

afterEach(() => {
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

function actorCookie(handle: string): string {
  actorCounter += 1;
  const storageHandle = canonicaliseOperatorHandle(handle);
  const room = createChatRoom({ name: `${handle} room`, whoCreatedIt: storageHandle });
  const db = getIdentityDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const terminalId = `lens_${storageHandle.replace(/[^a-z0-9]/gi, '_')}_${actorCounter}`;
  db.prepare(
    `INSERT OR IGNORE INTO terminals
      (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status, source, expires_at, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'verified', 'test', ?, '{}', ?, ?)`
  ).run(terminalId, actorCounter, `test-${actorCounter}`, `${storageHandle} terminal`, nowSec + 99999, nowSec, nowSec);
  db.prepare(
    `INSERT OR IGNORE INTO room_memberships (id, room_id, handle, terminal_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`mem_${terminalId}`, room.id, storageHandle, terminalId, nowSec);
  const session = createBrowserSession({
    roomId: room.id,
    authorHandle: handle,
    browserSessionId: `bs_${terminalId}`
  });
  if (!session) throw new Error('Failed to create browser session');
  return session.browserSessionSecret;
}

function requestEvent(method: string, body?: unknown, cookie?: string): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `ant_browser_session=${cookie}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return {
    params: {},
    url: new URL('http://x/api/verification/lenses'),
    request: new Request('http://x/api/verification/lenses', {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } as Parameters<typeof GET>[0];
}

function lensEvent(lensId: string, method: string, body?: unknown, cookie?: string): Parameters<typeof GET_ONE>[0] {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `ant_browser_session=${cookie}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return {
    params: { lensId },
    request: new Request(`http://x/api/verification/lenses/${encodeURIComponent(lensId)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } as Parameters<typeof GET_ONE>[0];
}

async function createLens(cookie = actorCookie('@you')): Promise<{ id: string; cookie: string }> {
  const response = await run(POST as unknown as Handler, requestEvent('POST', {
    name: 'Board Memo Lens',
    description: 'Board memo verification rules.',
    lensKind: 'custom',
    scope: 'user',
    rules: validRules,
    reason: 'route test'
  }, cookie));
  expect(response.status).toBe(201);
  const body = await response.json() as { lens: { id: string } };
  return { id: body.lens.id, cookie };
}

describe('/api/verification/lenses', () => {
  it('creates a premium lens with V2 rules and writes an audit row', async () => {
    const cookie = actorCookie('@you');
    const response = await run(POST as unknown as Handler, requestEvent('POST', {
      name: 'Board Memo Lens',
      description: 'Board memo verification rules.',
      lensKind: 'custom',
      scope: 'user',
      rules: validRules,
      reason: 'first draft'
    }, cookie));

    expect(response.status).toBe(201);
    const body = await response.json() as { lens: { id: string; rules: unknown; scopeId: string } };
    expect(body.lens.rules).toEqual(validRules);
    expect(body.lens.scopeId).toBe('@JWPK');

    const stored = getValidationSchema(body.lens.id);
    expect(stored?.rulesJson).toBe(JSON.stringify(validRules));
    expect(listValidationSchemaAuditForSchema(body.lens.id).map((entry) => entry.action)).toEqual(['create']);
  });

  it('rejects malformed V2 rules instead of silently dropping invalid blocks', async () => {
    const response = await run(POST as unknown as Handler, requestEvent('POST', {
      name: 'Bad Lens',
      rules: {
        version: 2,
        blocks: {
          claim_material: { mode: 'all', requirements: [{ kind: 'agent', count: 0 }] }
        }
      }
    }, actorCookie('@you')));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining('Invalid lens rules') });
  });

  it('lists visible lenses with parsed rules', async () => {
    const cookie = actorCookie('@you');
    const created = await createLens(cookie);
    const response = await run(GET as unknown as Handler, requestEvent('GET', undefined, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { lenses: Array<{ id: string; rules: unknown }> };
    expect(body.lenses.find((lens) => lens.id === created.id)?.rules).toEqual(validRules);
  });

  it('reads, updates, and soft-deletes a lens with audit entries', async () => {
    const { id, cookie } = await createLens();

    const read = await run(GET_ONE as unknown as Handler, lensEvent(id, 'GET', undefined, cookie));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ lens: { id, name: 'Board Memo Lens' } });

    const nextRules = {
      version: 2,
      blocks: {
        number: { mode: 'any', requirements: [{ kind: 'website', count: 1, allowedDomains: ['fca.org.uk'] }] }
      }
    };
    const updated = await run(PATCH as unknown as Handler, lensEvent(id, 'PATCH', {
      name: 'Updated Board Lens',
      rules: nextRules,
      reason: 'tightened number checks'
    }, cookie));
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ lens: { id, name: 'Updated Board Lens', rules: nextRules } });

    const deleted = await run(DELETE as unknown as Handler, lensEvent(id, 'DELETE', { reason: 'obsolete' }, cookie));
    expect(deleted.status).toBe(204);
    expect(listValidationSchemaAuditForSchema(id).map((entry) => entry.action)).toEqual([
      'archive',
      'update',
      'create'
    ]);

    const audit = await run(GET_AUDIT as unknown as Handler, lensAuditEvent(id, cookie));
    expect(audit.status).toBe(200);
    await expect(audit.json()).resolves.toMatchObject({
      audit: [
        { action: 'archive', actorHandle: '@JWPK' },
        { action: 'update', actorHandle: '@JWPK' },
        { action: 'create', actorHandle: '@JWPK' }
      ]
    });
  });
});

function lensAuditEvent(lensId: string, cookie?: string): Parameters<typeof GET_AUDIT>[0] {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `ant_browser_session=${cookie}`;
  return {
    params: { lensId },
    request: new Request(`http://x/api/verification/lenses/${encodeURIComponent(lensId)}/audit`, { headers })
  } as Parameters<typeof GET_AUDIT>[0];
}
