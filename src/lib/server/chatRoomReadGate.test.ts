/**
 * Tests for the debug instrumentation in resolveChatRoomReadAccess.
 *
 * Banked in `project_auth_gate_latency_investigation_2026_05_24.md`: this
 * instrumentation is the diagnostic path for the 3-21s 401 latency on
 * /api/chat-rooms. The tests prove:
 *   - When ANT_AUTH_GATE_DEBUG is unset, NO log line is emitted (zero
 *     overhead on the production hot path).
 *   - When set to '1', exactly ONE line lands on stderr with the expected
 *     shape (resolver names + ms + total + result + roomId).
 *
 * We can't import `resolveChatRoomReadAccess` from this file directly
 * because the AUTH_GATE_DEBUG constant is captured at module-load time —
 * Vitest needs `vi.resetModules()` between the unset and set cases so
 * the module-level constant re-reads the env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAuthDebug = process.env.ANT_AUTH_GATE_DEBUG;

async function loadGate() {
  // Reset module cache so module-level AUTH_GATE_DEBUG re-reads env.
  vi.resetModules();
  return await import('./chatRoomReadGate');
}

function buildUnauthRequest(): Request {
  // No Authorization, no cookie — every resolver should return null.
  return new Request('http://localhost/api/chat-rooms');
}

describe('resolveChatRoomReadAccess debug instrumentation', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-auth-gate-debug-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'fresh.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbPath;
    if (previousAuthDebug === undefined) delete process.env.ANT_AUTH_GATE_DEBUG;
    else process.env.ANT_AUTH_GATE_DEBUG = previousAuthDebug;
    vi.restoreAllMocks();
  });

  it('emits NO stderr trace when ANT_AUTH_GATE_DEBUG is unset', async () => {
    delete process.env.ANT_AUTH_GATE_DEBUG;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { resolveChatRoomReadAccess } = await loadGate();

    const access = await resolveChatRoomReadAccess(buildUnauthRequest());

    expect(access).toBeNull();
    const authGateLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('[auth-gate]'));
    expect(authGateLines).toEqual([]);
  });

  it('emits a single auth-gate trace line when ANT_AUTH_GATE_DEBUG=1', async () => {
    process.env.ANT_AUTH_GATE_DEBUG = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { resolveChatRoomReadAccess } = await loadGate();

    const access = await resolveChatRoomReadAccess(buildUnauthRequest(), 'room-x');

    expect(access).toBeNull();
    const authGateLines = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('[auth-gate]'));
    expect(authGateLines).toHaveLength(1);
    const line = authGateLines[0];
    // Every resolver should appear once.
    expect(line).toMatch(/admin=\d+ms/);
    expect(line).toMatch(/local=\d+ms/);
    expect(line).toMatch(/accounts=\d+ms/);
    expect(line).toMatch(/roomInvite=\d+ms/);
    expect(line).toMatch(/browserSession=\d+ms/);
    expect(line).toMatch(/antSession=\d+ms/);
    expect(line).toMatch(/pidChain=\d+ms/);
    expect(line).toMatch(/totalMs=\d+/);
    expect(line).toContain('result=null');
    expect(line).toContain('roomId=room-x');
    // None of them hit, so no '*' markers in the unauth case.
    expect(line).not.toContain('*=');
  });

  it('resolves room read access from a durable ANT session header', async () => {
    delete process.env.ANT_AUTH_GATE_DEBUG;
    const { resolveChatRoomReadAccess } = await loadGate();
    const { createSession } = await import('./antSessionStore');
    const { addMember } = await import('./membershipStore');

    const session = createSession({
      id: 'sess-read-access',
      kind: 'local-cli',
      label: '@durable-reader',
      terminalId: 't-durable-reader'
    });
    addMember('room-durable', '@durable-reader', session.id);
    const request = new Request('http://localhost/api/chat-rooms/room-durable/status', {
      headers: { 'x-ant-session-id': session.id }
    });

    const access = await resolveChatRoomReadAccess(request, 'room-durable');

    expect(access).toMatchObject({
      isAdminBearer: false,
      source: 'ant-session',
      handles: ['@durable-reader'],
      principalHandles: ['@durable-reader'],
      resolvedRoomIds: ['room-durable']
    });
  });

  it('does not resolve room read access from a retired handle lease', async () => {
    delete process.env.ANT_AUTH_GATE_DEBUG;
    const { resolveChatRoomReadAccess } = await loadGate();
    const { createSession } = await import('./antSessionStore');
    const { addMember, removeMember } = await import('./membershipStore');
    const { removeHandle } = await import('./roomHandleLeaseClean');

    const session = createSession({
      id: 'sess-retired-reader',
      kind: 'local-cli',
      label: '@retired-reader',
      terminalId: 't-retired-reader'
    });
    addMember('room-retired', '@retired-reader', session.id);
    expect(removeMember('room-retired', '@retired-reader')).toBe(true);
    expect(removeHandle('room-retired', '@retired-reader')).toBeNull();

    const request = new Request('http://localhost/api/chat-rooms/room-retired/status', {
      headers: { 'x-ant-session-id': session.id }
    });

    await expect(resolveChatRoomReadAccess(request, 'room-retired')).resolves.toBeNull();
  });

  it('forge-denial: room-less listing uses the registered handle only, not a name-slug', async () => {
    delete process.env.ANT_AUTH_GATE_DEBUG;
    const { resolveChatRoomReadAccess } = await loadGate();
    const { upsertTerminal } = await import('./terminalsStore');
    const { createTerminalRecord } = await import('./terminalRecordsStore');

    // Positive control: a REGISTERED terminal resolves to its explicit handle,
    // proving the room-less pidChain plumbing works.
    const reg = upsertTerminal({ pid: 41001, pid_start: 'reg', name: 'Registered' });
    createTerminalRecord({ sessionId: reg.id, name: 'Registered', handle: '@registered' });
    const regChain = encodeURIComponent(JSON.stringify([{ pid: 41001, pid_start: 'reg' }]));
    const regAccess = await resolveChatRoomReadAccess(
      new Request(`http://localhost/api/chat-rooms?pidChain=${regChain}`)
    );
    expect(regAccess?.principalHandles).toContain('@registered');

    // Forge: an UNREGISTERED terminal (handle unset) whose self-declared name
    // slugs to a victim handle must NOT resolve. Old behaviour returned
    // '@victim' (deriveHandle slug) and could list that member's rooms.
    const forge = upsertTerminal({ pid: 41002, pid_start: 'forge', name: 'victim' });
    createTerminalRecord({ sessionId: forge.id, name: 'victim' });
    const forgeChain = encodeURIComponent(JSON.stringify([{ pid: 41002, pid_start: 'forge' }]));
    const forgeAccess = await resolveChatRoomReadAccess(
      new Request(`http://localhost/api/chat-rooms?pidChain=${forgeChain}`)
    );
    expect(forgeAccess).toBeNull();
  });
});
