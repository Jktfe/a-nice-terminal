import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { resolveDurableSession, resolveOrNull } from './sessionResolver';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-resolver-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('sessionResolver — self-heal, never a stale-rebind 403', () => {
  it('resolves a durable session by token', () => {
    const s = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const out = resolveDurableSession(s.id, undefined, s.created_at_ms + 1);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.session.id).toBe(s.id);
  });

  it('SELF-HEALS across a runtime/pid change — the rebind is a no-op', () => {
    // Create "under pid 100", then resolve later presenting pid 999 — exactly
    // the day-roll / restart scenario that 403s today. It must succeed.
    const s = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    const out = resolveDurableSession(s.id, { pid: 999 }, s.created_at_ms + 60_000);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.session.id).toBe(s.id); // same identity, different runtime
      expect(out.healed).toBe(true); // flagged as a heal, not a failure
      expect(out.session.last_seen_at_ms).toBe(s.created_at_ms + 60_000); // liveness refreshed
    }
  });

  it('unknown token returns ok:false (caller decides — e.g. auto-join), never throws', () => {
    const out = resolveDurableSession('no-such-token');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('unknown-token');
  });

  it('resolveOrNull: session on a good token, null on missing/empty — no throw', () => {
    const s = createSession({ kind: 'remote-agent', label: '@macxeno' });
    expect(resolveOrNull(s.id)?.id).toBe(s.id);
    expect(resolveOrNull(null)).toBeNull();
    expect(resolveOrNull('')).toBeNull();
    expect(resolveOrNull('ghost')).toBeNull();
  });
});
