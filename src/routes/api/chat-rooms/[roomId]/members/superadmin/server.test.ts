import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, DELETE } from './+server';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { createSession } from '$lib/server/antSessionStore';
import { seedDefaultOrg, addUser, DEFAULT_ORG_ID } from '$lib/server/orgStore';
import { claimHandle, resolveMember, listLeases } from '$lib/server/roomHandleLeaseClean';

const ROOM_ID = 'room-superadmin-test';
const ADMIN_TOKEN = 'test-admin-token-superadmin-members';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;
const prevAdminToken = process.env.ANT_ADMIN_TOKEN;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-superadmin-members-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  // Seed the clean org so @JWPK is a superadmin; non-seeded handles are not.
  seedDefaultOrg();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  if (prevAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdminToken;
  if (prevVault === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = prevVault;
});

type Headers = Record<string, string>;

function eventForPost(body: unknown, headers: Headers = {}) {
  const url = new URL(`http://localhost/api/chat-rooms/${ROOM_ID}/members/superadmin`);
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { request, params: { roomId: ROOM_ID }, url } as unknown as Parameters<typeof POST>[0];
}

function eventForDelete(body: unknown, headers: Headers = {}, query = '') {
  const url = new URL(
    `http://localhost/api/chat-rooms/${ROOM_ID}/members/superadmin${query}`
  );
  const request = new Request(url.toString(), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { request, params: { roomId: ROOM_ID }, url } as unknown as Parameters<typeof DELETE>[0];
}

async function run(p: unknown): Promise<Response> {
  try {
    return (await p) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

const adminHeaders: Headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

/** Create a durable session labelled @handle so it can be resolved as a target. */
function seedTargetSession(handle: string): string {
  const session = createSession({ kind: 'remote-agent', label: handle });
  return session.id;
}

// New model (2026-06-10 spoof-close): the superadmin route no longer trusts a
// session's self-declared label. A durable-session caller authenticates through
// the shared mutating gate, which requires a CLEAN room-handle lease and
// resolves the LEASE handle. So these helpers claim a clean lease for the
// caller — the lease, not the label, is what the gate trusts.

/** Mint a SuperAdmin caller session that is a clean member of the room. */
function seedSuperAdminCaller(handle: string): string {
  addUser(DEFAULT_ORG_ID, handle, 'superadmin');
  const session = createSession({ kind: 'human', label: handle });
  claimHandle(ROOM_ID, handle, session.id);
  return session.id;
}

/** Mint a non-privileged caller session that is a clean member of the room. */
function seedMemberCaller(handle: string): string {
  addUser(DEFAULT_ORG_ID, handle, 'member');
  const session = createSession({ kind: 'remote-agent', label: handle });
  claimHandle(ROOM_ID, handle, session.id);
  return session.id;
}

describe('POST /api/chat-rooms/:roomId/members/superadmin (add)', () => {
  it('admin-bearer SuperAdmin adds @x → claimHandle runs, returns granted display', async () => {
    seedTargetSession('@x');
    const res = await run(POST(eventForPost({ handle: '@x' }, adminHeaders)));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.handle).toBe('@x');
    // claimHandle actually ran: @x's clean holder is the seeded target session.
    expect(listLeases(ROOM_ID).some((l) => l.handle === '@x' && l.active)).toBe(true);
  });

  it('SuperAdmin via durable session (x-ant-session-id) adds @x → 201', async () => {
    const callerSession = seedSuperAdminCaller('@JWPK');
    const targetSession = seedTargetSession('@x');
    const res = await run(
      POST(eventForPost({ handle: '@x' }, { 'x-ant-session-id': callerSession }))
    );
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.handle).toBe('@x');
    expect(resolveMember(ROOM_ID, '@x')).toBe(targetSession);
  });

  it('adds a live cutover agent whose handle is still on terminal_records, not ant_sessions.label', async () => {
    const db = getIdentityDb();
    const targetSession = createSession({
      kind: 'local-cli',
      label: 'MasterClaude Terminal',
      terminalId: 't_masterclaude'
    });
    const now = Date.now();
    db.prepare(
      `INSERT INTO terminal_records
         (session_id, name, auto_forward_chat, handle, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('t_masterclaude', 'MasterClaude Terminal', 1, '@masterclaude', now, now);

    const res = await run(POST(eventForPost({ handle: '@masterclaude' }, adminHeaders)));
    expect(res.status).toBe(201);
    expect(resolveMember(ROOM_ID, '@masterclaude')).toBe(targetSession.id);
  });

  it('non-SuperAdmin caller → 403, target claimHandle does NOT run', async () => {
    const callerSession = seedMemberCaller('@nobody');
    seedTargetSession('@x');
    const res = await run(
      POST(eventForPost({ handle: '@x' }, { 'x-ant-session-id': callerSession }))
    );
    expect(res.status).toBe(403);
    // The TARGET @x was never granted (the caller holds only its own @nobody
    // lease from seedMemberCaller; the route's claimHandle on @x didn't run).
    expect(resolveMember(ROOM_ID, '@x')).toBeFalsy();
  });

  it('forge-denial: a session self-labelled as the operator with no clean lease is not granted SuperAdmin', async () => {
    // The exact register-time spoof: an attacker mints a session whose label is
    // the operator handle (@JWPK is seeded superadmin) while having no clean
    // room-handle lease. The gate never resolves an unleased session, so the
    // self-declared label can no longer escalate to SuperAdmin.
    const attacker = createSession({ kind: 'remote-agent', label: '@JWPK' });
    seedTargetSession('@x');
    const res = await run(
      POST(eventForPost({ handle: '@x' }, { 'x-ant-session-id': attacker.id }))
    );
    expect(res.status).not.toBe(201);
    expect([401, 403]).toContain(res.status);
    expect(resolveMember(ROOM_ID, '@x')).toBeFalsy();
  });

  it('add when target has no durable session → 409 (not 500)', async () => {
    // @ghost has no ant_sessions row.
    const res = await run(POST(eventForPost({ handle: '@ghost' }, adminHeaders)));
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(String(payload.message)).toContain('no durable session');
    expect(listLeases(ROOM_ID).length).toBe(0);
  });

  it('returns the suffixed display when @x is already held by another session', async () => {
    // Pre-existing clean holder for @x.
    const incumbent = createSession({ kind: 'remote-agent', label: '@x-incumbent' });
    claimHandle(ROOM_ID, '@x', incumbent.id);
    // A different durable session also labelled @x is the add target.
    seedTargetSession('@x');
    const res = await run(POST(eventForPost({ handle: '@x' }, adminHeaders)));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.handle).toBe('@x-1');
  });

  it('missing handle in body → 400', async () => {
    const res = await run(POST(eventForPost({}, adminHeaders)));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/chat-rooms/:roomId/members/superadmin (remove)', () => {
  it('SuperAdmin removes @x → removeHandle runs, returns @x-N', async () => {
    const holder = seedTargetSession('@x');
    claimHandle(ROOM_ID, '@x', holder);
    const res = await run(DELETE(eventForDelete({ handle: '@x' }, adminHeaders)));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.retiredAs).toBe('@x-1');
    // @x's clean slot is now free (the holder was retired/suffixed).
    expect(resolveMember(ROOM_ID, '@x')).toBeNull();
  });

  it('SuperAdmin via durable session removes by ?handle= query → 200', async () => {
    const callerSession = seedSuperAdminCaller('@JWPK');
    const holder = seedTargetSession('@y');
    claimHandle(ROOM_ID, '@y', holder);
    const res = await run(
      DELETE(eventForDelete(undefined, { 'x-ant-session-id': callerSession }, '?handle=@y'))
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.retiredAs).toBe('@y-1');
  });

  it('remove non-existent holder → 404', async () => {
    const res = await run(DELETE(eventForDelete({ handle: '@nope' }, adminHeaders)));
    expect(res.status).toBe(404);
  });

  it('non-SuperAdmin remove → 403, holder untouched', async () => {
    const callerSession = seedMemberCaller('@nobody');
    const holder = seedTargetSession('@x');
    claimHandle(ROOM_ID, '@x', holder);
    const res = await run(
      DELETE(eventForDelete({ handle: '@x' }, { 'x-ant-session-id': callerSession }))
    );
    expect(res.status).toBe(403);
    // Still the active clean holder — removeHandle did not run.
    expect(resolveMember(ROOM_ID, '@x')).toBe(holder);
  });

  it('missing handle (no body, no query) → 400', async () => {
    const res = await run(DELETE(eventForDelete(undefined, adminHeaders)));
    expect(res.status).toBe(400);
  });
});
