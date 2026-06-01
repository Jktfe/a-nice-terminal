import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAgentStatus,
  setAgentStatus,
  listEventsForTerminal,
  isAllowedAgentStatus,
  isAllowedAgentStatusSource
} from './agentStatusStore';
import { resetIdentityDbForTests } from './db';
import {
  upsertTerminal,
  getTerminalById,
  markPaneVerified,
  markPaneStale
} from './terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-agent-status-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('agentStatusStore (M3.4a-v2 T1)', () => {
  it('isAllowedAgentStatus rejects unknown strings and the v2-rejected blocked/offline values', () => {
    expect(isAllowedAgentStatus('idle')).toBe(true);
    expect(isAllowedAgentStatus('thinking')).toBe(true);
    expect(isAllowedAgentStatus('working')).toBe(true);
    expect(isAllowedAgentStatus('response-required')).toBe(true);
    expect(isAllowedAgentStatus('blocked')).toBe(false);
    expect(isAllowedAgentStatus('offline')).toBe(false);
    expect(isAllowedAgentStatus('')).toBe(false);
    expect(isAllowedAgentStatus(null)).toBe(false);
  });

  it('isAllowedAgentStatusSource accepts the five canonical sources and rejects others', () => {
    expect(isAllowedAgentStatusSource('fingerprint')).toBe(true);
    expect(isAllowedAgentStatusSource('hook')).toBe(true);
    expect(isAllowedAgentStatusSource('ant-activity')).toBe(true);
    expect(isAllowedAgentStatusSource('pid-cpu')).toBe(true);
    expect(isAllowedAgentStatusSource('default')).toBe(true);
    expect(isAllowedAgentStatusSource('manual')).toBe(false);
    expect(isAllowedAgentStatusSource('')).toBe(false);
  });

  it('getAgentStatus returns null for an unknown terminal_id', () => {
    expect(getAgentStatus('does-not-exist')).toBeNull();
  });

  it('getAgentStatus returns the idle-default-fallback row for a freshly registered terminal', () => {
    const terminal = upsertTerminal({ pid: 5001, pid_start: 'p1', name: 'fresh' });
    const row = getAgentStatus(terminal.id);
    expect(row).not.toBeNull();
    expect(row?.terminal_id).toBe(terminal.id);
    expect(row?.agent_status).toBe('idle');
    expect(row?.agent_status_source).toBe('default');
    expect(row?.agent_status_at_ms).toBe(0);
  });

  it('setAgentStatus writes the terminals row and appends an event atomically', () => {
    const terminal = upsertTerminal({ pid: 5002, pid_start: 'p2', name: 'set-test' });
    const result = setAgentStatus({
      terminalId: terminal.id,
      newStatus: 'thinking',
      source: 'fingerprint',
      nowMs: 1_700_000_000_000
    });
    expect(result.agent_status).toBe('thinking');
    expect(result.agent_status_source).toBe('fingerprint');
    expect(result.agent_status_at_ms).toBe(1_700_000_000_000);

    const read = getAgentStatus(terminal.id);
    expect(read?.agent_status).toBe('thinking');
    expect(read?.agent_status_source).toBe('fingerprint');

    const events = listEventsForTerminal(terminal.id);
    expect(events).toHaveLength(1);
    expect(events[0].prev_status).toBe('idle');
    expect(events[0].new_status).toBe('thinking');
    expect(events[0].source).toBe('fingerprint');
    expect(events[0].changed_at_ms).toBe(1_700_000_000_000);
  });

  it('setAgentStatus records a transition chain with prev_status preserved on each event', () => {
    const terminal = upsertTerminal({ pid: 5003, pid_start: 'p3', name: 'chain' });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'thinking', source: 'fingerprint', nowMs: 100 });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'working', source: 'fingerprint', nowMs: 200 });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'response-required', source: 'hook', nowMs: 300 });

    const events = listEventsForTerminal(terminal.id);
    expect(events).toHaveLength(3);
    expect(events.map((e) => `${e.prev_status}->${e.new_status}`)).toEqual([
      'working->response-required',
      'thinking->working',
      'idle->thinking'
    ]);
    expect(events.map((e) => e.source)).toEqual(['hook', 'fingerprint', 'fingerprint']);
  });

  it('setAgentStatus throws on unknown terminal_id without writing any row or event', () => {
    expect(() =>
      setAgentStatus({ terminalId: 'orphan', newStatus: 'thinking', source: 'fingerprint' })
    ).toThrow(/not found/);
    expect(listEventsForTerminal('orphan')).toEqual([]);
  });

  it('setAgentStatus rejects an invalid agent_status value before writing anything', () => {
    const terminal = upsertTerminal({ pid: 5004, pid_start: 'p4', name: 'bad-status' });
    expect(() =>
      setAgentStatus({
        terminalId: terminal.id,
        newStatus: 'blocked' as unknown as 'idle',
        source: 'fingerprint'
      })
    ).toThrow(/agent_status must be one of/);
    expect(listEventsForTerminal(terminal.id)).toEqual([]);
  });

  it('setAgentStatus rejects an invalid source value before writing anything', () => {
    const terminal = upsertTerminal({ pid: 5005, pid_start: 'p5', name: 'bad-source' });
    expect(() =>
      setAgentStatus({
        terminalId: terminal.id,
        newStatus: 'thinking',
        source: 'manual' as unknown as 'fingerprint'
      })
    ).toThrow(/agent_status_source must be one of/);
    expect(listEventsForTerminal(terminal.id)).toEqual([]);
  });

  it('setAgentStatus persists evidence_json when supplied and null when omitted', () => {
    const terminal = upsertTerminal({ pid: 5006, pid_start: 'p6', name: 'evidence' });
    setAgentStatus({
      terminalId: terminal.id,
      newStatus: 'thinking',
      source: 'fingerprint',
      evidence: { lines: ['working...'], cpu: 0.42 },
      nowMs: 1
    });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'working', source: 'fingerprint', nowMs: 2 });

    const events = listEventsForTerminal(terminal.id);
    expect(events[0].evidence_json).toBeNull();
    expect(events[1].evidence_json).not.toBeNull();
    const parsed = JSON.parse(events[1].evidence_json as string);
    expect(parsed.cpu).toBe(0.42);
  });

  it('setAgentStatus does NOT mutate pane_status (M3.4a-v1 v2 parallel-column invariant per RQO T1-B1 bar)', () => {
    const verified = upsertTerminal({ pid: 6001, pid_start: 'pv', name: 'v1-verified' });
    markPaneVerified(verified.id);
    const stale = upsertTerminal({ pid: 6002, pid_start: 'ps', name: 'v1-stale' });
    markPaneStale(stale.id);

    setAgentStatus({ terminalId: verified.id, newStatus: 'thinking', source: 'fingerprint' });
    setAgentStatus({ terminalId: verified.id, newStatus: 'working', source: 'fingerprint' });
    setAgentStatus({ terminalId: stale.id, newStatus: 'response-required', source: 'hook' });

    const verifiedAfter = getTerminalById(verified.id);
    expect(verifiedAfter?.pane_status).toBe('verified');
    expect(verifiedAfter?.pane_stale_since).toBeNull();

    const staleAfter = getTerminalById(stale.id);
    expect(staleAfter?.pane_status).toBe('stale');
    expect(typeof staleAfter?.pane_stale_since).toBe('number');
  });

  it('listEventsForTerminal returns events in changed_at_ms DESC + id DESC order (newest first)', () => {
    const terminal = upsertTerminal({ pid: 5007, pid_start: 'p7', name: 'ordering' });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'thinking', source: 'fingerprint', nowMs: 10 });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'working', source: 'fingerprint', nowMs: 10 });
    setAgentStatus({ terminalId: terminal.id, newStatus: 'idle', source: 'fingerprint', nowMs: 20 });

    const events = listEventsForTerminal(terminal.id);
    expect(events).toHaveLength(3);
    expect(events[0].new_status).toBe('idle');
    expect(events[0].changed_at_ms).toBe(20);
    expect(events[1].new_status).toBe('working');
    expect(events[2].new_status).toBe('thinking');
  });
});
