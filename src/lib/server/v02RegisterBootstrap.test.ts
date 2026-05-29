import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bootstrapV02Identity,
  pidStartToIso,
  resolveV02ByPidChain
} from './v02RegisterBootstrap';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';
import * as v02Runtimes from './v02RuntimesStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-bootstrap-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('pidStartToIso', () => {
  it('passes through a valid ISO 8601 string', () => {
    const iso = pidStartToIso('2026-05-13T12:34:56.789Z');
    expect(iso).toBe('2026-05-13T12:34:56.789Z');
  });

  it('converts a ps -o lstart=-style English date to ISO', () => {
    // Date.parse treats the lstart string as a LOCAL time, so the
    // resulting UTC ISO depends on TZ. Just assert the year + Z suffix.
    const iso = pidStartToIso('Tue May 13 00:00:00 2026');
    expect(iso.startsWith('2026-05-1')).toBe(true);
    expect(iso.endsWith('Z')).toBe(true);
  });

  it('returns a synthetic ISO for null', () => {
    const iso = pidStartToIso(null, 1_700_000_000_000);
    expect(iso).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('marks unparseable input with #unparseable suffix', () => {
    const iso = pidStartToIso('not-a-date-at-all', 1_700_000_000_000);
    expect(iso.endsWith('#unparseable')).toBe(true);
  });
});

describe('bootstrapV02Identity', () => {
  it('creates a v02_agents row + v02_runtimes row on first call for a new handle', () => {
    const result = bootstrapV02Identity({
      name: 'cv4-test',
      pid: 1234,
      pid_start: 'Tue May 13 00:00:00 2026',
      tmux_pane: '%1',
      cli_provider_id: 'claude_code',
      legacy_terminal_id: 'legacy-term-1'
    });
    expect(result.agent_was_created).toBe(true);
    expect(result.prior_runtime_id).toBeNull();

    const agent = v02Agents.getAgentById(result.agent_id);
    expect(agent).not.toBeNull();
    expect(agent?.display_name).toBe('cv4-test');
    expect(agent?.primary_handle).toBe('@cv4-test');
    expect(agent?.current_runtime_id).toBe(result.runtime_id);

    const runtime = v02Runtimes.getRuntimeById(result.runtime_id);
    expect(runtime).not.toBeNull();
    expect(runtime?.agent_id).toBe(result.agent_id);
    expect(runtime?.pid).toBe(1234);
    expect(runtime?.pid_start_iso.startsWith('2026-05-1')).toBe(true);
    expect(runtime?.pid_start_iso.endsWith('Z')).toBe(true);
    expect(runtime?.tmux_pane).toBe('%1');
    expect(runtime?.cli_provider_id).toBe('claude_code');
    expect(runtime?.status).toBe('live');
    expect(runtime?.register_challenge_proof).toBe('pre-v02-attestation:legacy-term-1');
  });

  it('respects an explicit handle override when supplied', () => {
    const result = bootstrapV02Identity({
      name: 'James Pane',
      handle: '@you',
      pid: 2,
      pid_start: null,
      legacy_terminal_id: 'legacy-term-x'
    });
    const agent = v02Agents.getAgentById(result.agent_id);
    expect(agent?.primary_handle).toBe('@you');
    expect(agent?.display_name).toBe('James Pane');
  });

  it('normalises a handle without a leading @', () => {
    const result = bootstrapV02Identity({
      name: 'codex4',
      handle: 'codex4',
      pid: 99,
      pid_start: null,
      legacy_terminal_id: 'legacy-term-y'
    });
    const agent = v02Agents.getAgentById(result.agent_id);
    expect(agent?.primary_handle).toBe('@codex4');
  });

  it('reclaims an existing live runtime on second call from a different PID', () => {
    const first = bootstrapV02Identity({
      name: 'cv4-test',
      pid: 1,
      pid_start: 'Tue May 13 00:00:00 2026',
      legacy_terminal_id: 'legacy-term-A'
    });
    const second = bootstrapV02Identity({
      name: 'cv4-test',
      pid: 2,
      pid_start: 'Wed May 14 00:00:00 2026',
      legacy_terminal_id: 'legacy-term-B'
    });
    expect(second.agent_was_created).toBe(false);
    expect(second.agent_id).toBe(first.agent_id);
    expect(second.runtime_id).not.toBe(first.runtime_id);
    expect(second.prior_runtime_id).toBe(first.runtime_id);

    const oldRuntime = v02Runtimes.getRuntimeById(first.runtime_id);
    expect(oldRuntime?.status).toBe('reclaimed');
    expect(oldRuntime?.reclaimed_by_runtime_id).toBe(second.runtime_id);

    const newRuntime = v02Runtimes.getRuntimeById(second.runtime_id);
    expect(newRuntime?.status).toBe('live');

    const agent = v02Agents.getAgentById(first.agent_id);
    expect(agent?.current_runtime_id).toBe(second.runtime_id);
    expect(agent?.reclaim_count).toBe(1);
  });

  it('writes agent.created + runtime.registered audit events on first call', () => {
    const result = bootstrapV02Identity({
      name: 'audit-test',
      pid: 555,
      pid_start: null,
      legacy_terminal_id: 'legacy-term-audit'
    });
    const db = getIdentityDb();
    const rows = db
      .prepare(
        `SELECT kind, entity_kind, entity_id FROM v02_audit_events
          WHERE entity_id = ? OR entity_id = ?
          ORDER BY at_ms ASC`
      )
      .all(result.agent_id, result.runtime_id) as {
      kind: string;
      entity_kind: string;
      entity_id: string;
    }[];
    expect(rows.find((r) => r.kind === 'agent.created')).toBeTruthy();
    expect(rows.find((r) => r.kind === 'runtime.registered')).toBeTruthy();
  });

  it('does NOT write a second agent.created event on re-register', () => {
    bootstrapV02Identity({
      name: 'cv4-test',
      pid: 1,
      pid_start: null,
      legacy_terminal_id: 'legacy-term-A'
    });
    bootstrapV02Identity({
      name: 'cv4-test',
      pid: 2,
      pid_start: null,
      legacy_terminal_id: 'legacy-term-B'
    });
    const db = getIdentityDb();
    const createdCount = db
      .prepare(`SELECT COUNT(*) AS c FROM v02_audit_events WHERE kind = 'agent.created'`)
      .get() as { c: number };
    expect(createdCount.c).toBe(1);
  });

  it('throws on empty name', () => {
    expect(() =>
      bootstrapV02Identity({
        name: '',
        pid: 1,
        pid_start: null,
        legacy_terminal_id: 'legacy-term-empty'
      })
    ).toThrow();
  });

  it('enforces the at-most-one-live-runtime invariant via the partial unique index', () => {
    // Direct INSERT bypassing the bootstrap helper to confirm the index
    // we depend on actually exists and rejects dual-live inserts.
    const agent = v02Agents.createAgent({
      display_name: 'invariant-test',
      primary_handle: '@invariant-test'
    });
    v02Runtimes.registerRuntime({
      agent_id: agent.agent_id,
      host: 'local',
      pid: 1,
      pid_start_iso: new Date().toISOString(),
      register_challenge_proof: 'p1'
    });
    expect(() =>
      v02Runtimes.registerRuntime({
        agent_id: agent.agent_id,
        host: 'local',
        pid: 2,
        pid_start_iso: new Date().toISOString(),
        register_challenge_proof: 'p2'
      })
    ).toThrow();
  });
});

describe('resolveV02ByPidChain', () => {
  it('returns the live runtime + agent_id when the leaf pid matches', () => {
    const isoNow = new Date().toISOString();
    const bootstrap = bootstrapV02Identity({
      name: 'resolve-test',
      pid: 4242,
      pid_start: isoNow,
      legacy_terminal_id: 'legacy-term-resolve'
    });
    const resolved = resolveV02ByPidChain([{ pid: 4242, pid_start: isoNow }]);
    expect(resolved).not.toBeNull();
    expect(resolved?.runtime_id).toBe(bootstrap.runtime_id);
    expect(resolved?.agent_id).toBe(bootstrap.agent_id);
  });

  it('walks the chain — returns ancestor when leaf pid is unknown', () => {
    const isoNow = new Date().toISOString();
    const bootstrap = bootstrapV02Identity({
      name: 'ancestor-test',
      pid: 100,
      pid_start: isoNow,
      legacy_terminal_id: 'legacy-term-anc'
    });
    const resolved = resolveV02ByPidChain([
      { pid: 99999, pid_start: 'unknown' },
      { pid: 100, pid_start: isoNow }
    ]);
    expect(resolved?.runtime_id).toBe(bootstrap.runtime_id);
  });

  it('returns null when nothing in the chain resolves', () => {
    const resolved = resolveV02ByPidChain([{ pid: 88888, pid_start: 'nada' }]);
    expect(resolved).toBeNull();
  });

  it('returns null on empty chain', () => {
    expect(resolveV02ByPidChain([])).toBeNull();
  });

  it('respects status=live filter — reclaimed runtimes do not resolve', () => {
    const isoNow = new Date().toISOString();
    const first = bootstrapV02Identity({
      name: 'reclaim-test',
      pid: 7,
      pid_start: isoNow,
      legacy_terminal_id: 'legacy-term-RA'
    });
    // Second register reclaims the first (different PID), but using the
    // OLD pid+pid_start_iso to look up should now miss (status filter).
    bootstrapV02Identity({
      name: 'reclaim-test',
      pid: 8,
      pid_start: isoNow,
      legacy_terminal_id: 'legacy-term-RB'
    });
    const resolved = resolveV02ByPidChain([{ pid: 7, pid_start: isoNow }]);
    // The old runtime is 'reclaimed' so it MUST NOT resolve. We expect
    // null here because there's no entry with pid=7 still live.
    expect(resolved).toBeNull();
    // Sanity: the original runtime was reclaimed.
    const oldRuntime = v02Runtimes.getRuntimeById(first.runtime_id);
    expect(oldRuntime?.status).toBe('reclaimed');
  });
});
