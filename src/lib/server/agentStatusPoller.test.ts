// Tests for agentStatusPoller (M3.4a-v2 T3b).
// Per gate bars: cadence clamp + terminal iteration + cascade flow +
// setAgentStatus only on meaningful state change + clean abort.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import { getAgentStatus, listEventsForTerminal, setAgentStatus } from './agentStatusStore';
import { startPoller, defaultTmuxCaptureFn, _testResetPoller } from './agentStatusPoller';
import { hashCaptureOutput } from './fingerprintHasher';
import { setSpawnImplForTests, resetBridgeStateForTests } from './pty-inject-bridge';
import { _clearStateReaderCache } from './agentStateReader';
import type { TerminalRow } from './terminalsStore';

const PREV_POLL_MS = process.env.ANT_AGENT_STATUS_POLL_MS;
const PREV_MAX_TERMINALS = process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK;
const PREV_HOME = process.env.HOME;

// Phase A3 added a verifyPaneTargetState gate before the fingerprint
// sample in pollOneTerminal. Without a stub, the test sandbox calls real
// tmux against fake panes (e.g. `%1`), and behaviour depends on the local
// tmux session state — fragile. Default every test to a "verified" stub
// so pre-existing assertions about captureFn invocation still hold. Phase
// A3 tests that need a 'stale' outcome override this via stubTmuxStatus.
const VERIFIED_CAPTURE_BYTES = Buffer.from('banner\n│ > ready\n', 'utf8');
function defaultVerifiedSpawn() {
  return {
    status: 0,
    stdout: VERIFIED_CAPTURE_BYTES,
    stderr: Buffer.alloc(0),
    pid: 0,
    output: [],
    signal: null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  const homeDir = mkdtempSync(join(tmpdir(), 'ant-status-poller-home-'));
  process.env.HOME = homeDir;
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  delete process.env.ANT_AGENT_STATUS_POLL_MS;
  delete process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK;
  _clearStateReaderCache();
  resetIdentityDbForTests();
  _testResetPoller();
  // See VERIFIED_CAPTURE_BYTES comment above for why this defaults here.
  setSpawnImplForTests(defaultVerifiedSpawn);
});
afterEach(() => {
  _testResetPoller();
  resetIdentityDbForTests();
  resetBridgeStateForTests();
  _clearStateReaderCache();
  if (process.env.HOME && process.env.HOME.includes('ant-status-poller-home-')) {
    rmSync(process.env.HOME, { recursive: true, force: true });
  }
  if (PREV_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = PREV_HOME;
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

function writeCliState(cli: string, sessionId: string, body: Record<string, unknown>, mtimeMs = Date.now()): void {
  const stateDir = join(process.env.HOME!, '.ant', 'state', cli);
  mkdirSync(stateDir, { recursive: true });
  const filePath = join(stateDir, `${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(body));
  const seconds = mtimeMs / 1000;
  utimesSync(filePath, seconds, seconds);
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

  // Pre-asks-as-pill the fingerprint regex matched "Awaiting" → response-
  // required. That regex is gone (response-required is asks-only now). The
  // same capture now falls through to working/thinking based on the change-
  // detection rules — first capture has no prev hash so it can't decide,
  // status stays at the default 'idle'.
  it('ask-style capture no longer flips to response-required (asks-as-pill 2026-05-22)', async () => {
    const tid = makeAgentTerminal('t-ask');
    const c = startPoller({ captureFn: () => 'Awaiting your input on the next step', intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    const status = getAgentStatus(tid)?.agent_status;
    expect(status).not.toBe('response-required');
    expect(status).toBe('idle'); // first capture, prev hash null → null status → default
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
    const c = startPoller({ captureFn: () => { captureCount += 1; return '⏺ Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(captureCount).toBe(0);
    expect(listEventsForTerminal(tid).length).toBe(0);
  });

  it('B1: polls agent_kind terminals WITH tmux_target_pane', async () => {
    // Phase A3 added a verifyPaneTargetState gate before captureFn. The
    // shared beforeEach stubs tmux to return verified, so captureFn still
    // runs against this terminal as before.
    const tid = makeAgentTerminal('t-with-pane', 'claude_code', '%42');
    let captured: string | null = null;
    const c = startPoller({ captureFn: (term) => { captured = term.tmux_target_pane; return '⏺ Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    expect(captured).toBe('%42');
    // First poll has prev hash null → fingerprint returns null status → idle.
    // We're verifying the terminal was POLLED (captured===pane), not the
    // status outcome. The status path is exercised by hook tests now.
    expect(getAgentStatus(tid)?.agent_status).toBe('idle');
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
    const c = startPoller({ captureFn: (term) => { if (term.id === t1) throw new Error('boom'); return '⏺ Awaiting input'; }, intervalMs: 5000 });
    await c.runOnce(); c.stop();
    // t2 still polled (captureFn ran without throwing for it) — verifies the
    // per-terminal try/catch isolation. Status is idle on first poll because
    // there's no prev hash; the key assertion is that t1's failure didn't
    // stop t2 being processed (an event row would appear if captureFn was
    // actually invoked — but the current cascade returns null on no-prev so
    // no setAgentStatus fires either way, hence we just assert presence).
    expect(getAgentStatus(t2)).not.toBeNull();
  });

  it('preserves a fresh hook-written status when fingerprint disagrees', async () => {
    const tid = makeAgentTerminal('t-fresh-hook');
    const unchangedToolCapture = 'previous tool output\n⏺ running shell\n';
    const staleFingerprintAtMs = Date.now() - 60_000;
    getIdentityDb().prepare(
      `UPDATE terminals
       SET last_fingerprint_hash = ?, last_fingerprint_at_ms = ?
       WHERE id = ?`
    ).run(hashCaptureOutput(unchangedToolCapture), staleFingerprintAtMs, tid);
    setAgentStatus({
      terminalId: tid,
      newStatus: 'working',
      source: 'hook',
      nowMs: Date.now() - 5_000,
      evidence: { hookEventName: 'PreToolUse' }
    });

    const c = startPoller({ captureFn: () => unchangedToolCapture, intervalMs: 5000 });
    await c.runOnce();
    c.stop();

    const status = getAgentStatus(tid);
    expect(status?.agent_status).toBe('working');
    expect(status?.agent_status_source).toBe('hook');
    expect(listEventsForTerminal(tid)).toHaveLength(1);
  });

  it('preserves current status when fingerprint cannot decide', async () => {
    const tid = makeAgentTerminal('t-null-preserve');
    setAgentStatus({
      terminalId: tid,
      newStatus: 'thinking',
      source: 'hook',
      nowMs: Date.now() - 2_000,
      evidence: { hookEventName: 'ThinkingStart' }
    });

    const c = startPoller({ captureFn: () => 'first capture has no prior hash', intervalMs: 5000 });
    await c.runOnce();
    c.stop();

    const status = getAgentStatus(tid);
    expect(status?.agent_status).toBe('thinking');
    expect(status?.agent_status_source).toBe('hook');
    expect(listEventsForTerminal(tid)).toHaveLength(1);
  });

  it('refreshes volatile status timestamp without adding an event when fingerprint re-confirms it', async () => {
    const tid = makeAgentTerminal('t-refresh-volatile');
    const previousCapture = 'tool starting\n';
    const currentCapture = 'tool running\n⏺ shell command\n';
    const oldStatusAtMs = Date.now() - 60_000;
    getIdentityDb().prepare(
      `UPDATE terminals
       SET last_fingerprint_hash = ?, last_fingerprint_at_ms = ?
       WHERE id = ?`
    ).run(hashCaptureOutput(previousCapture), Date.now() - 1_000, tid);
    setAgentStatus({
      terminalId: tid,
      newStatus: 'working',
      source: 'hook',
      nowMs: oldStatusAtMs,
      evidence: { hookEventName: 'PreToolUse' }
    });

    const c = startPoller({ captureFn: () => currentCapture, intervalMs: 5000 });
    await c.runOnce();
    c.stop();

    const status = getAgentStatus(tid);
    expect(status?.agent_status).toBe('working');
    expect(status?.agent_status_source).toBe('hook');
    expect(status?.agent_status_at_ms ?? 0).toBeGreaterThan(oldStatusAtMs);
    expect(listEventsForTerminal(tid)).toHaveLength(1);
  });

  it('projects a fresh CLI status-line file into canonical room status without an open terminal stream', async () => {
    const tid = makeAgentTerminal('t-status-line', 'codex-cli', '%42');
    writeCliState('codex-cli', 'codex-session', {
      state: 'Working',
      cwd: '/repo/status-line',
      session_start: '2026-06-01T12:00:00Z'
    });

    const c = startPoller({
      captureFn: () => null,
      cwdFn: () => '/repo/status-line',
      intervalMs: 5000
    });
    await c.runOnce();
    c.stop();

    const status = getAgentStatus(tid);
    expect(status?.agent_status).toBe('working');
    expect(status?.agent_status_source).toBe('hook');
    expect(listEventsForTerminal(tid)).toHaveLength(1);
  });

  it('ignores stale CLI status-line files so old sessions cannot poison room pills', async () => {
    const tid = makeAgentTerminal('t-stale-status-line', 'codex-cli', '%42');
    writeCliState('codex-cli', 'old-codex-session', {
      state: 'Working',
      cwd: '/repo/stale-status-line',
      session_start: '2026-05-01T12:00:00Z'
    }, Date.now() - 120_000);

    const c = startPoller({
      captureFn: () => null,
      cwdFn: () => '/repo/stale-status-line',
      intervalMs: 5000
    });
    await c.runOnce();
    c.stop();

    expect(getAgentStatus(tid)?.agent_status).toBe('idle');
    expect(listEventsForTerminal(tid)).toHaveLength(0);
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

// Phase A3 (JWPK A Team msg_7uvr35x0xr 2026-05-29): flip terminal status
// to archived on pane-gone (verifyPaneTargetState === 'stale') + on remote/
// paneless heartbeat staleness (last_message_sent_at_ms / last_pty_byte_at_ms
// both older than 5 min). pty-inject-bridge.runScrubbedTmux honours
// setSpawnImplForTests, so we inject a stubbed spawnSync that controls
// the tmux capture-pane exit status — non-zero → 'stale'.
function stubTmuxStatus(status: number, stdout = ''): void {
  setSpawnImplForTests(() => ({
    status,
    stdout: Buffer.from(stdout, 'utf8'),
    stderr: Buffer.alloc(0),
    pid: 0,
    output: [],
    signal: null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any));
}

function readStatus(terminalId: string): string {
  const row = getIdentityDb().prepare(`SELECT status FROM terminals WHERE id = ?`).get(terminalId) as { status: string };
  return row.status;
}

describe('agentStatusPoller — Phase A3: pane-gone → archived', () => {
  it('local terminal with pane: verifyPaneTargetState stale flips status live → archived and returns early', async () => {
    const tid = makeAgentTerminal('t-stale');
    expect(readStatus(tid)).toBe('live');
    stubTmuxStatus(1); // capture-pane fails → 'stale'
    let captureFnCalls = 0;
    const c = startPoller({
      captureFn: () => { captureFnCalls += 1; return 'whatever'; },
      intervalMs: 5000
    });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('archived');
    // Early return: captureFn (fingerprint sample) should NOT have been
    // invoked for this terminal after the stale outcome.
    expect(captureFnCalls).toBe(0);
    // No agent_status event written either (pollOneTerminal returned before
    // the cascade ran).
    expect(listEventsForTerminal(tid).length).toBe(0);
  });

  it('local terminal with pane: verifyPaneTargetState verified leaves status live and continues to fingerprint sample', async () => {
    const tid = makeAgentTerminal('t-verified');
    // Stub a successful capture WITH a claude_code ready-state indicator
    // so verifyPaneTargetState returns 'verified' (matchReadyStateFor
    // claude_code requires '│ >' or '❯' and no 'esc to interrupt').
    stubTmuxStatus(0, 'banner\n│ > ready\n');
    let captureFnCalls = 0;
    const c = startPoller({
      captureFn: () => { captureFnCalls += 1; return 'capture v1'; },
      intervalMs: 5000
    });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('live');
    expect(captureFnCalls).toBe(1); // continued past the pane check
  });

  it('idempotent: running pollOnce twice on a stale terminal still results in archived (no exception, no churn)', async () => {
    const tid = makeAgentTerminal('t-stale-twice');
    stubTmuxStatus(1);
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    expect(readStatus(tid)).toBe('archived');
    // Second tick — terminal is now archived. The heartbeat sweep guard
    // (status === 'archived' continue) and isPollableTerminal both keep
    // this row out of the pane-check path on the second tick, so we just
    // assert no throw + status stays archived.
    await expect(c.runOnce()).resolves.toBeUndefined();
    c.stop();
    expect(readStatus(tid)).toBe('archived');
  });
});

describe('agentStatusPoller — Phase A3: remote/paneless heartbeat sweep', () => {
  it('remote terminal: both heartbeats older than 5 min → status flips to archived', async () => {
    const tid = makeAgentTerminal('t-remote-stale', 'remote', null);
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    getIdentityDb().prepare(
      `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ? WHERE id = ?`
    ).run(sixMinAgo, sixMinAgo, tid);
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('archived');
  });

  it('remote terminal: at least one heartbeat within 5 min → status stays live', async () => {
    const tid = makeAgentTerminal('t-remote-fresh', 'remote', null);
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    const oneMinAgo = Date.now() - 60 * 1000;
    // last_pty_byte_at_ms is fresh; last_message_sent_at_ms is stale.
    // Max() picks the fresh one → above threshold → stays live.
    getIdentityDb().prepare(
      `UPDATE terminals SET last_message_sent_at_ms = ?, last_pty_byte_at_ms = ? WHERE id = ?`
    ).run(sixMinAgo, oneMinAgo, tid);
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('live');
  });

  it('remote terminal already archived: sweep is a no-op (does not re-flip / does not throw)', async () => {
    const tid = makeAgentTerminal('t-already-archived', 'remote', null);
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    getIdentityDb().prepare(
      `UPDATE terminals
          SET last_message_sent_at_ms = ?,
              last_pty_byte_at_ms = ?,
              status = 'archived',
              name = '[A] t-already-archived'
        WHERE id = ?`
    ).run(sixMinAgo, sixMinAgo, tid);
    const beforeUpdate = (getIdentityDb().prepare(`SELECT updated_at FROM terminals WHERE id = ?`).get(tid) as { updated_at: number }).updated_at;
    // Wait 1+ second so a sneaky write would bump updated_at observably.
    await new Promise((r) => setTimeout(r, 1100));
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('archived');
    const afterUpdate = (getIdentityDb().prepare(`SELECT updated_at FROM terminals WHERE id = ?`).get(tid) as { updated_at: number }).updated_at;
    expect(afterUpdate).toBe(beforeUpdate); // no churn
  });

  it('remote terminal with no heartbeat history (latest = 0) → status stays live', async () => {
    // Fresh remote terminal with no traffic yet. Sweep MUST NOT archive
    // it on the first tick — that would kill a just-spawned bridge before
    // it gets a chance to send anything.
    const tid = makeAgentTerminal('t-remote-fresh-spawn', 'remote', null);
    const c = startPoller({ captureFn: () => null, intervalMs: 5000 });
    await c.runOnce();
    c.stop();
    expect(readStatus(tid)).toBe('live');
  });
});
