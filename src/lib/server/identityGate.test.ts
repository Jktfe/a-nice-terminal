import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';
import { parsePidChainFromBody, resolveServerSideHandle, resolveBearerOrPidChain } from './identityGate';
import { createTerminalRecord } from './terminalRecordsStore';
import { createAdmission } from './remoteAdmissionStore';
import { createMapping, revokeMapping } from './remoteMappingStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-identity-gate-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('parsePidChainFromBody', () => {
  it('returns empty array when pidChain absent', () => {
    expect(parsePidChainFromBody({})).toEqual([]);
  });

  it('returns empty array when pidChain is not an array', () => {
    expect(parsePidChainFromBody({ pidChain: 'nope' })).toEqual([]);
    expect(parsePidChainFromBody({ pidChain: 42 })).toEqual([]);
  });

  it('drops malformed entries silently and keeps valid ones', () => {
    const chain = parsePidChainFromBody({
      pidChain: [
        { pid: 100, pid_start: 'a' },
        { pid: 'not-a-number', pid_start: 'b' },
        { pid: 0, pid_start: 'c' },
        null,
        { pid: 200 }
      ]
    });
    expect(chain).toEqual([
      { pid: 100, pid_start: 'a' },
      { pid: 200, pid_start: null }
    ]);
  });

  it('floors fractional pids and rejects negative/Infinity', () => {
    const chain = parsePidChainFromBody({
      pidChain: [
        { pid: 12.9, pid_start: null },
        { pid: -5 },
        { pid: Number.POSITIVE_INFINITY }
      ]
    });
    expect(chain).toEqual([{ pid: 12, pid_start: null }]);
  });
});

describe('resolveServerSideHandle', () => {
  it('returns null on empty chain', () => {
    expect(resolveServerSideHandle('r1', [])).toBeNull();
  });

  it('returns null when no terminal matches', () => {
    const handle = resolveServerSideHandle('r1', [{ pid: 99999, pid_start: 'missing' }]);
    expect(handle).toBeNull();
  });

  it('returns null when terminal exists but no membership in that room', () => {
    const t = upsertTerminal({ pid: 1234, pid_start: 'ps', name: 'lonely' });
    addMembership({ room_id: 'rOther', handle: '@l', terminal_id: t.id });
    expect(resolveServerSideHandle('r1', [{ pid: 1234, pid_start: 'ps' }])).toBeNull();
  });

  it('returns the room-scoped handle on full match', () => {
    const t = upsertTerminal({ pid: 5555, pid_start: 'ps5', name: 'speaker' });
    addMembership({ room_id: 'r1', handle: '@speaker', terminal_id: t.id });
    expect(resolveServerSideHandle('r1', [{ pid: 5555, pid_start: 'ps5' }])).toBe('@speaker');
  });

  // FINDING-3 LINKEDCHAT-SELF-HANDLE
  it('self-identifies via explicit derived handle when terminal posts to its OWN linked room (no membership)', () => {
    const t = upsertTerminal({ pid: 6100, pid_start: 'pl', name: 'linked-codex' });
    createTerminalRecord({ sessionId: t.id, name: 'linked-codex', linkedChatRoomId: 'rLinked', handle: '@codex' });
    expect(resolveServerSideHandle('rLinked', [{ pid: 6100, pid_start: 'pl' }])).toBe('@codex');
  });

  it('self-identifies via name-slug derived handle when no explicit handle set', () => {
    const t = upsertTerminal({ pid: 6200, pid_start: 'pl2', name: 'Linked Gemini' });
    createTerminalRecord({ sessionId: t.id, name: 'Linked Gemini', linkedChatRoomId: 'rLinked2' });
    expect(resolveServerSideHandle('rLinked2', [{ pid: 6200, pid_start: 'pl2' }])).toBe('@linked-gemini');
  });

  it('does NOT leak self-handle when terminal linked room is a DIFFERENT room', () => {
    const t = upsertTerminal({ pid: 6300, pid_start: 'pl3', name: 'elsewhere' });
    createTerminalRecord({ sessionId: t.id, name: 'elsewhere', linkedChatRoomId: 'rOther', handle: '@elsewhere' });
    expect(resolveServerSideHandle('rLinked3', [{ pid: 6300, pid_start: 'pl3' }])).toBeNull();
  });

  it('membership handle takes precedence over linked-room self-handle', () => {
    const t = upsertTerminal({ pid: 6400, pid_start: 'pl4', name: 'both' });
    createTerminalRecord({ sessionId: t.id, name: 'both', linkedChatRoomId: 'r1', handle: '@self' });
    addMembership({ room_id: 'r1', handle: '@member', terminal_id: t.id });
    expect(resolveServerSideHandle('r1', [{ pid: 6400, pid_start: 'pl4' }])).toBe('@member');
  });
});

describe('resolveBearerOrPidChain (M4 Q6 hook)', () => {
  function newRemoteMapping(roomId: string, label: string) {
    const adm = createAdmission({ roomId, lifetimePreset: '48h' });
    return createMapping({
      roomId, remoteInstanceLabel: label, admissionId: adm.admission.id,
      lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
    });
  }
  function reqWith(authHeader: string | null): Request {
    return new Request('http://x/', { headers: authHeader === null ? {} : { authorization: authHeader } });
  }

  it('Bearer rbt_<valid> resolves to synthetic remote handle', () => {
    const m = newRemoteMapping('r1', 'inst-bearer');
    const handle = resolveBearerOrPidChain('r1', reqWith(`Bearer ${m.bridgeToken}`), {});
    expect(handle).toBe('@inst-bearer');
  });

  it('Bearer rbt_<revoked> returns null (security: revoked bearer fails BEFORE pidChain)', () => {
    const m = newRemoteMapping('r1', 'inst-revoked');
    revokeMapping(m.mapping.id);
    expect(resolveBearerOrPidChain('r1', reqWith(`Bearer ${m.bridgeToken}`), {})).toBeNull();
  });

  it('Bearer rbt_<unknown> returns null (does NOT fall through to pidChain on bad rbt_ bearer)', () => {
    const t = upsertTerminal({ pid: 7000, pid_start: 'pf', name: 'fallback' });
    addMembership({ room_id: 'r1', handle: '@fallback', terminal_id: t.id });
    const handle = resolveBearerOrPidChain('r1', reqWith('Bearer rbt_unknownbytes'), { pidChain: [{ pid: 7000, pid_start: 'pf' }] });
    expect(handle).toBeNull();
  });

  it('No bearer header → falls through to existing pidChain path', () => {
    const t = upsertTerminal({ pid: 8000, pid_start: 'pg', name: 'pidonly' });
    addMembership({ room_id: 'r1', handle: '@pidonly', terminal_id: t.id });
    expect(resolveBearerOrPidChain('r1', reqWith(null), { pidChain: [{ pid: 8000, pid_start: 'pg' }] })).toBe('@pidonly');
  });

  it('Bearer NOT prefixed rbt_ (e.g. admin bearer) → falls through to pidChain path', () => {
    const t = upsertTerminal({ pid: 9000, pid_start: 'ph', name: 'admin-bearer-fallthrough' });
    addMembership({ room_id: 'r1', handle: '@admin-bf', terminal_id: t.id });
    expect(resolveBearerOrPidChain('r1', reqWith('Bearer admin-token-xyz'), { pidChain: [{ pid: 9000, pid_start: 'ph' }] })).toBe('@admin-bf');
  });
});
