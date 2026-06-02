import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  createSession,
  ensureSession,
  getSession,
  markSessionSeen,
  childSessions
} from './antSessionStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-session-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('antSessionStore — durable identity, not pid-derived', () => {
  it('mints a durable session id with no pid coupling', () => {
    const s = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    expect(s.id).toMatch(/[0-9a-f-]{36}/); // a UUID, not a pid
    expect(s.kind).toBe('local-cli');
    expect(s.label).toBe('auto:speedy');
    expect(s.parent_session_id).toBeNull();
    // The session object carries NO pid/pid_start — identity is decoupled
    // from the runtime by construction.
    expect(Object.keys(s)).not.toContain('pid');
    expect(Object.keys(s)).not.toContain('pid_start');
  });

  it('resolves the SAME identity after a simulated restart (re-resolve by id)', () => {
    const created = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    // A restart / day-roll would drift the pid — but the session is keyed by
    // its durable id, so re-resolving returns the identical identity. This is
    // the lockout fix: no pid in the resolution path.
    const resolved = getSession(created.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(created.id);
    expect(resolved!.label).toBe('auto:speedy');
  });

  it('liveness (last_seen) is distinct from identity and never gates it', () => {
    const s = createSession({ kind: 'remote-agent', label: '@macxeno' });
    const seen = markSessionSeen(s.id, s.created_at_ms + 5_000);
    expect(seen).not.toBeNull();
    expect(seen!.last_seen_at_ms).toBe(s.created_at_ms + 5_000);
    // Identity unchanged by a liveness touch.
    expect(seen!.id).toBe(s.id);
    expect(getSession(s.id)!.id).toBe(s.id);
  });

  it('rejects an unknown kind', () => {
    // @ts-expect-error — deliberately invalid kind
    expect(() => createSession({ kind: 'wormhole', label: 'x' })).toThrow(/unknown kind/);
  });

  it('links a subagent to its parent and lists children', () => {
    const parent = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const child = createSession({
      kind: 'subagent',
      label: 'auto:speedy/reviewer',
      parentSessionId: parent.id
    });
    expect(child.parent_session_id).toBe(parent.id);
    const kids = childSessions(parent.id);
    expect(kids).toHaveLength(1);
    expect(kids[0].id).toBe(child.id);
  });

  it('rejects a subagent whose parent does not exist', () => {
    expect(() =>
      createSession({ kind: 'subagent', label: 'orphan', parentSessionId: 'no-such-session' })
    ).toThrow(/does not exist/);
  });

  it('returns null resolving an unknown id (no throw)', () => {
    expect(getSession('nope')).toBeNull();
    expect(markSessionSeen('nope')).toBeNull();
  });

  it('createSession honours a supplied id (the durable client token)', () => {
    const s = createSession({ id: 'client-token-abc', kind: 'local-cli', label: 'auto:speedy' });
    expect(s.id).toBe('client-token-abc');
    expect(getSession('client-token-abc')!.label).toBe('auto:speedy');
  });

  it('createSession rejects a duplicate id (steers to ensureSession)', () => {
    createSession({ id: 'dup', kind: 'local-cli' });
    expect(() => createSession({ id: 'dup', kind: 'local-cli' })).toThrow(/already exists/);
  });
});

describe('ensureSession — the activation entry point (resolve-or-create by token)', () => {
  it('creates on first call, resolves the SAME identity on every later call (durable across restart)', () => {
    const first = ensureSession('tok-1', { kind: 'local-cli', label: 'auto:speedy' });
    expect(first.id).toBe('tok-1');
    // A "restart" re-presents the same token -> same identity, not a new row.
    const again = ensureSession('tok-1', { kind: 'local-cli', label: 'auto:speedy' });
    expect(again.id).toBe('tok-1');
    expect(again.created_at_ms).toBe(first.created_at_ms); // not re-created
  });

  it('touches liveness on resolve', () => {
    const first = ensureSession('tok-2', { kind: 'remote-agent' });
    const again = ensureSession('tok-2', { kind: 'remote-agent' });
    expect(again.last_seen_at_ms).toBeGreaterThanOrEqual(first.last_seen_at_ms);
    expect(again.id).toBe('tok-2');
  });
});
