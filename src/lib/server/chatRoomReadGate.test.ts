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
    expect(line).toMatch(/pidChain=\d+ms/);
    expect(line).toMatch(/totalMs=\d+/);
    expect(line).toContain('result=null');
    expect(line).toContain('roomId=room-x');
    // None of them hit, so no '*' markers in the unauth case.
    expect(line).not.toContain('*=');
  });
});
