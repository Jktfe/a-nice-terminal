import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { ensureOrg, addUser, seedDefaultOrg, DEFAULT_SUPERADMIN_HANDLE } from './orgStore';
import { resolveCaller, canManageMemberships } from './cleanIdentityResolve';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-resolve-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('cleanIdentityResolve — server-authoritative, handle-keyed', () => {
  it('resolves a handle alone (no session) — identity does not require a runtime', () => {
    ensureOrg('o1', 'Org');
    addUser('o1', '@alice', 'member');
    const r = resolveCaller({ handle: '@alice' });
    expect(r).toEqual({ handle: '@alice', sessionId: null, isSuperAdmin: false });
  });

  it('resolves a handle + a real session, attaching the durable sessionId', () => {
    const s = createSession({ kind: 'local-cli', label: 'alice-cli' });
    addUser('o1', '@alice', 'member');
    const r = resolveCaller({ handle: '@alice', sessionId: s.id });
    expect(r?.handle).toBe('@alice');
    expect(r?.sessionId).toBe(s.id);
  });

  it('IGNORES an unknown session id (server-authoritative) but still resolves by handle', () => {
    addUser('o1', '@alice', 'member');
    const r = resolveCaller({ handle: '@alice', sessionId: 'not-a-real-session' });
    expect(r?.handle).toBe('@alice');
    expect(r?.sessionId).toBeNull(); // unknown session not trusted
  });

  it('returns null when neither a handle nor a resolvable session is present', () => {
    expect(resolveCaller({})).toBeNull();
    expect(resolveCaller({ sessionId: 'ghost' })).toBeNull();
    expect(resolveCaller({ handle: '' })).toBeNull();
  });

  it('rejects the "@you" sentinel — no identity minted from it', () => {
    expect(resolveCaller({ handle: '@you' })).toBeNull();
    expect(resolveCaller({ handle: 'you' })).toBeNull();
  });

  it('a resolvable session with NO handle does not mint an identity (handle-keyed, no terminal path)', () => {
    const s = createSession({ kind: 'remote-agent', label: 'anon' });
    expect(resolveCaller({ sessionId: s.id })).toBeNull();
  });

  it('reports isSuperAdmin from orgStore', () => {
    seedDefaultOrg();
    const r = resolveCaller({ handle: DEFAULT_SUPERADMIN_HANDLE });
    expect(r?.isSuperAdmin).toBe(true);
  });

  it('canManageMemberships is true only for a superadmin', () => {
    seedDefaultOrg();
    addUser('NewModel', '@alice', 'admin');
    expect(canManageMemberships(DEFAULT_SUPERADMIN_HANDLE)).toBe(true);
    expect(canManageMemberships('@alice')).toBe(false); // admin != superadmin for membership mgmt
    expect(canManageMemberships('@nobody')).toBe(false);
  });

  it('trims surrounding whitespace on the presented handle', () => {
    addUser('o1', '@alice', 'member');
    const r = resolveCaller({ handle: '  @alice  ' });
    expect(r?.handle).toBe('@alice');
  });
});
