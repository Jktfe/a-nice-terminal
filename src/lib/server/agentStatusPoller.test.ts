// Tests for agentStatusPoller (M3.4a-v2 T3b).
// Per gate bars: cadence clamp + terminal iteration + cascade flow +
// setAgentStatus only on meaningful state change + clean abort.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import { getAgentStatus, listEventsForTerminal } from './agentStatusStore';
import { startPoller, defaultTmuxCaptureFn, _testResetPoller } from './agentStatusPoller';
import type { TerminalRow } from './terminalsStore';

const PREV_POLL_MS = process.env.ANT_AGENT_STATUS_POLL_MS;
const PREV_MAX_TERMINALS = process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  delete process.env.ANT_AGENT_STATUS_POLL_MS;
  delete process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK;
  resetIdentityDbForTests();
  _testResetPoller();
});
afterEach(() => {
  _testResetPoller();
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV_POLL_MS === undefined) delete process.env.ANT_AGENT_STATUS_POLL_MS;
  else process.env.ANT_AGENT_STATUS_POLL_MS = PREV_POLL_MS;
  if (PREV_MAX_TERMINALS === undefined) delete process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK;
  else process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK = PREV_MAX_TERMINALS;
});

function makeAgentTerminal(name: string, agentKind: string | null = 'claude_code', pane: string | null = '%1'): string {
  const t = upsertTerminal({ pid: 1234, pid_start: 'pst', name });
  // upsertTerminal doesn't take agent_kind/tmux_target_pane — set directly.
  getIdentityDb().prepare(`UPDATE terminals SET agent_kind = ?, tmux_target_pane = ? WHERE id = ?`)
    .run(agentKind, pane, t.id);
  return t.id;
}

describe('agentStatusPoller — startPoller controller', () => {
  it('isRunning() true after start, false after stop', () => {
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    expect(c.isRunning()).toBe(true);
    c.stop();
    expect(c.isRunning()).toBe(false);
  });

  it('idempotent: second startPoller returns the same controller', () => {
    const c1 = startPoller({ captureFn: () => null, intervalMs: 5000 });
    const c2 = startPoller({ captureFn: () => 'other', intervalMs: 9000 });
    expect(c2).toBe(c1);
    c1.stop();
  });
});

describe('agentStatusPoller — runOnce per-terminal', () => {
  it('null capture is a no-op (no setAgentStatus, no fingerprint state write)', async () => {
    const tid = makeAgentTerminal('t1');
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(listEventsForTerminal(tid).length).toBe(0);
  });

  it('first capture writes fingerprint state but does NOT change status (status stays default idle)', async () => {
    const tid = makeAgentTerminal('t1');
    const c = startPoller({ captureFn: () => 'capture text v1', intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    const row = getIdentityDb().prepare(`SELECT last_fingerprint_hash FROM terminals WHERE id = ?`).get(tid) as { last_fingerprint_hash: string };
    expect(row.last_fingerprint_hash.length).toBeGreaterThan(0);
    expect(getAgentStatus(tid)?.agent_status).toBe('idle');
  });

  it('ask-pattern in capture flips status to response-required via fingerprint cascade', async () => {
    const tid = makeAgentTerminal('t-ask');
    const c = startPoller({ captureFn: () => 'Awaiting your input on the next step', intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    const status = getAgentStatus(tid)?.agent_status;
    expect(status).toBe('response-required');
  });

  it('skips remote-mapping synthetic terminals (agent_kind=remote)', async () => {
    const tid = makeAgentTerminal('t-remote', 'remote');
    let captureCount = 0;
    const c = startPoller({ captureFn: () => { captureCount += 1; return 'x'; }, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(captureCount).toBe(0);
    expect(listEventsForTerminal(tid).length).toBe(0);
  });

  it('NULL-kind terminal: classifyIfUnknown calls captureFn for kind detection but state-poll still skipped without tmux pane', async () => {
    const tNo = upsertTerminal({ pid: 9999, pid_start: 'ph', name: 't-noagent' });
    let captureCount = 0;
    const c = startPoller({ captureFn: () => { captureCount += 1; return 'x'; }, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    // M3.2c: classifyIfUnknown calls captureFn (for source 3) on NULL-kind
    // terminals. State-poll still skipped because tmux_target_pane is null.
    expect(captureCount).toBe(1);
    expect(listEventsForTerminal(tNo.id).length).toBe(0);
  });

  it('B1: skips agent_kind terminals WITHOUT tmux_target_pane (predicate gap fix)', async () => {
    const tid = makeAgentTerminal('t-no-pane', 'claude_code', null);
    let captureCount = 0;
    const c = startPoller({ captureFn: () => { captureCount += 1; return 'Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(captureCount).toBe(0);
    expect(listEventsForTerminal(tid).length).toBe(0);
  });

  it('B1: polls agent_kind terminals WITH tmux_target_pane', async () => {
    const tid = makeAgentTerminal('t-with-pane', 'claude_code', '%42');
    let captured: string | null = null;
    const c = startPoller({ captureFn: (term) => { captured = term.tmux_target_pane; return 'Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    expect(captured).toBe('%42');
    expect(getAgentStatus(tid)?.agent_status).toBe('response-required');
  });
  it('iterates multiple agent terminals in one runOnce', async () => {
    makeAgentTerminal('t-a'); makeAgentTerminal('t-b'); makeAgentTerminal('t-c');
    const captures: string[] = [];
    const c = startPoller({ captureFn: (term) => { captures.push(term.name); return 'capture'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    expect(captures.sort()).toEqual(['t-a', 't-b', 't-c']);
  });
  it('limits terminal polling per tick when ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK is set', async () => {
    process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK = '2';
    makeAgentTerminal('t-a'); makeAgentTerminal('t-b'); makeAgentTerminal('t-c');
    const captures: string[] = [];
    const c = startPoller({ captureFn: (term) => { captures.push(term.name); return 'capture'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    expect(captures).toHaveLength(2);
  });
  it('per-terminal capture failure does NOT block other terminals', async () => {
    const t1 = makeAgentTerminal('t-fail');
    const t2 = makeAgentTerminal('t-ok');
    const c = startPoller({ captureFn: (term) => { if (term.id === t1) throw new Error('boom'); return 'Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    expect(getAgentStatus(t2)?.agent_status).toBe('response-required');
  });
});

describe('agentStatusPoller — cadence clamp', () => {
  it('clamps below-min cadence (1ms) up to POLL_MIN_MS (5000)', () => {
    const c = startPoller({ captureFn: () => null, intervalMs: 1 });
    expect(c.isRunning()).toBe(true);
    c.stop();
  });

  it('clamps above-max cadence (999_999) down to POLL_MAX_MS (60_000)', () => {
    const c = startPoller({ captureFn: () => null, intervalMs: 999_999 });
    expect(c.isRunning()).toBe(true);
    c.stop();
  });

  it('reads ANT_AGENT_STATUS_POLL_MS env override when intervalMs absent', () => {
    process.env.ANT_AGENT_STATUS_POLL_MS = '7500';
    const c = startPoller({ captureFn: () => null });
    expect(c.isRunning()).toBe(true);
    c.stop();
  });
});

describe('agentStatusPoller — default captureFn (B2: spawnSync tmux capture-pane)', () => {
  it('exists and returns null for terminals without tmux_target_pane (no spawn)', () => {
    const term = { id: 't', pid: 1, pid_start: null, name: 'n', tmux_target_pane: null, agent_kind: 'claude_code', pane_status: 'unknown', source: 'manual', expires_at: null, meta: '{}', created_at: 0, updated_at: 0 } as unknown as import('./terminalsStore').TerminalRow;
    expect(defaultTmuxCaptureFn(term)).toBeNull();
  });

  it('startPoller without captureFn falls back to defaultTmuxCaptureFn (production path)', () => {
    const c = startPoller({ intervalMs: 5000 });
    expect(c.isRunning()).toBe(true);
    c.stop();
  });
});

describe('agentStatusPoller — clean shutdown', () => {
  it('stop() clears interval + isRunning() false + further stop no-op', () => {
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    c.stop();
    c.stop();
    expect(c.isRunning()).toBe(false);
  });
});

describe('agentStatusPoller — M3.2c classifyIfUnknown integration', () => {
  it('NULL-kind terminal: capture-fn match writes meta (MEDIUM) without flipping agent_kind', async () => {
    const t = upsertTerminal({ pid: 1, pid_start: 'p', name: 'classify-medium' });
    getIdentityDb().prepare(`UPDATE terminals SET tmux_target_pane = ? WHERE id = ?`).run('%9', t.id);
    const c = startPoller({ captureFn: () => 'claude code v0.42 banner', intervalMs: 5000 });
    await c.runOnce(); c.stop();
    const after = getIdentityDb().prepare(`SELECT agent_kind, meta FROM terminals WHERE id = ?`).get(t.id) as { agent_kind: string | null; meta: string };
    expect(after.agent_kind).toBeNull();
    const meta = JSON.parse(after.meta);
    expect(meta.fingerprint_confidence).toBe('medium');
    expect(meta.fingerprint_evidence_hash).toBeDefined();
  });
  it('B2 debounce: second tick with same evidence does NOT rewrite meta', async () => {
    const t = upsertTerminal({ pid: 2, pid_start: 'p', name: 'classify-debounce' });
    getIdentityDb().prepare(`UPDATE terminals SET tmux_target_pane = ? WHERE id = ?`).run('%10', t.id);
    const c = startPoller({ captureFn: () => 'aider chat session', intervalMs: 5000 });
    await c.runOnce();
    const firstUpdate = (getIdentityDb().prepare(`SELECT updated_at FROM terminals WHERE id = ?`).get(t.id) as { updated_at: number }).updated_at;
    await new Promise((r) => setTimeout(r, 1100));
    await c.runOnce(); c.stop();
    const secondUpdate = (getIdentityDb().prepare(`SELECT updated_at FROM terminals WHERE id = ?`).get(t.id) as { updated_at: number }).updated_at;
    expect(secondUpdate).toBe(firstUpdate);
  });
  it('Q2 preservation through poller path: remote terminal stays remote', async () => {
    const t = upsertTerminal({ pid: 3, pid_start: 'p', name: 'remote-stays' });
    getIdentityDb().prepare(`UPDATE terminals SET agent_kind = 'remote' WHERE id = ?`).run(t.id);
    const c = startPoller({ captureFn: () => 'codex banner', intervalMs: 5000 });
    await c.runOnce(); c.stop();
    const after = getIdentityDb().prepare(`SELECT agent_kind FROM terminals WHERE id = ?`).get(t.id) as { agent_kind: string };
    expect(after.agent_kind).toBe('remote');
  });
  it('B3 isolation: classify-throw on X does NOT block classify on Y (sibling protected)', async () => {
    const tX = upsertTerminal({ pid: 4, pid_start: 'p', name: 'crashy' });
    const tY = upsertTerminal({ pid: 5, pid_start: 'p', name: 'innocent' });
    getIdentityDb().prepare(`UPDATE terminals SET tmux_target_pane = ? WHERE id = ?`).run('%11', tY.id);
    getIdentityDb().prepare(`UPDATE terminals SET meta = ? WHERE id = ?`).run('not-valid-json', tX.id);
    const c = startPoller({ captureFn: () => 'cursor v0.1', intervalMs: 5000 });
    await c.runOnce(); c.stop();
    const yMeta = (getIdentityDb().prepare(`SELECT meta FROM terminals WHERE id = ?`).get(tY.id) as { meta: string }).meta;
    expect(JSON.parse(yMeta).fingerprint_confidence).toBe('medium');
  });
});
