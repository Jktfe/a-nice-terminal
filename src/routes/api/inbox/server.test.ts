// GET /api/inbox — the global held-ask + owner-notification surface
// (JWPK taste calls msg_n4gdutadlh + msg_lnaxbotljh: inbox not room-noise,
// global AND visible in the origin room via ?roomId= filter).
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createPermissionRequest } from '$lib/server/permissionRequestsStore';
import { appendLedger } from '$lib/server/identityLedgerStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevAdmin = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-inbox-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = 'inbox-test-admin-token';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
  if (prevAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdmin;
});

function eventForGet(query = '', headers: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/inbox${query}`);
  const request = new Request(url.toString(), { headers });
  return { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
}

async function callGet(query = '', headers: Record<string, string> = {}): Promise<Response> {
  try {
    return (await GET(eventForGet(query, headers))) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

const adminHeaders = { authorization: 'Bearer inbox-test-admin-token' };

function seedRequest(roomId: string, approver = '@JWPK') {
  return createPermissionRequest({
    requesterHandle: '@hopeful',
    action: 'chat.post',
    targetKind: 'room',
    targetId: roomId,
    approvers: [{ handle: approver, role: 'room_owner', preferred: true }]
  });
}

describe('GET /api/inbox', () => {
  it('401s without any credential', async () => {
    const response = await callGet();
    expect(response.status).toBe(401);
  });

  it('admin bearer sees pending held asks and owner notifications globally', async () => {
    seedRequest('room-a');
    seedRequest('room-b');
    appendLedger({
      kind: 'owner.notified', handle: '@dave', actor: 'daemon',
      detail: { reason: 'vacant-claim', owners: ['@JWPK'], pane: '%9' }
    });
    const response = await callGet('', adminHeaders);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.heldAsks).toHaveLength(2);
    expect(payload.ownerNotifications).toHaveLength(1);
    expect(payload.ownerNotifications[0].handle).toBe('@dave');
    expect(payload.heldAsks[0].approveCommand).toContain('approve');
  });

  it('?roomId= filters held asks to the origin room (the in-room half of the ruling)', async () => {
    seedRequest('room-a');
    seedRequest('room-b');
    const response = await callGet('?roomId=room-a', adminHeaders);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.heldAsks).toHaveLength(1);
    expect(payload.heldAsks[0].targetId).toBe('room-a');
  });
});
