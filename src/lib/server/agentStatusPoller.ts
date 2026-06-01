/**
 * agentStatusPoller — interval-driven daemon for the M3.4a-v2 fingerprint
 * cascade per contract Q3 (PRIMARY source) + Q6 (PID-CPU TIEBREAKER).
 *
 * Each tick: list active terminals → sample fingerprint via the injected
 * captureFn → deriveStateFromFingerprint vs the previous hash/ts read
 * from terminals.last_fingerprint_* → decideAgentStatus cascade with
 * fingerprint as primary (hook/ant-activity/pid-cpu sources are not
 * sampled by this poller; their inputs land via separate paths).
 *
 * Writes:
 *   - terminals.last_fingerprint_hash + last_fingerprint_at_ms updated
 *     every tick regardless of decision (so future ticks see the latest
 *     hash for change-detection).
 *   - setAgentStatus called ONLY when decision.status differs from the
 *     current agent_status (no-op writes avoided to keep events table
 *     audit-friendly).
 *
 * Cadence clamped 5..60 sec per Q3. Override via $ANT_AGENT_STATUS_POLL_MS.
 *
 * Singleton via globalThis (per feedback_globalthis_pattern). Idempotent
 * startPoller — calling twice returns the same controller without
 * spinning a second interval. Clean shutdown via controller.stop().
 */
import { listAllTerminals, setTerminalStatus, type TerminalRow } from './terminalsStore';
import { getAgentStatus, refreshAgentStatusAtMs, setAgentStatus, type AgentStatus } from './agentStatusStore';
import { deriveStateFromFingerprint, decideAgentStatus } from './fingerprintHasher';
import { detectFingerprint, applyFingerprintWriteBack } from './fingerprintDetector';
import { defaultTmuxCaptureFn, type CaptureFn } from './tmuxCapture';
import { verifyPaneTargetState } from './pty-inject-bridge';
import { getIdentityDb } from './db';
import { spawnSync } from 'node:child_process';
import {
  projectLiveAgentStateSnapshotToStatus,
  resolveAgentStateSnapshotForTerminal
} from './agentStateProjection';
export { defaultTmuxCaptureFn };
export type { CaptureFn };

const POLL_MIN_MS = 5_000;
const POLL_MAX_MS = 60_000;
const POLL_DEFAULT_MS = 10_000;
const POLL_MAX_TERMINALS_DEFAULT = 5;
const HOOK_FRESH_MS = 30_000;
const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const CWD_CACHE_TTL_MS = 5_000;

type CwdCacheEntry = { value: string | null; expiresAtMs: number };
const cwdCache = new Map<string, CwdCacheEntry>();

export type PollerController = {
  stop: () => void;
  runOnce: () => Promise<void>;
  isRunning: () => boolean;
};

const POLLER_GLOBAL_KEY = '__antAgentStatusPoller';

function clampCadence(rawMs: number | undefined): number {
  const fromEnv = Number(process.env.ANT_AGENT_STATUS_POLL_MS);
  const requested = rawMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : POLL_DEFAULT_MS);
  if (!Number.isFinite(requested) || requested <= 0) return POLL_DEFAULT_MS;
  if (requested < POLL_MIN_MS) return POLL_MIN_MS;
  if (requested > POLL_MAX_MS) return POLL_MAX_MS;
  return requested;
}

function readFingerprintState(terminalId: string): { prevHash: string | null; prevAtMs: number | null } {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT last_fingerprint_hash, last_fingerprint_at_ms
    FROM terminals WHERE id = ?`).get(terminalId) as
    { last_fingerprint_hash: string | null; last_fingerprint_at_ms: number | null } | undefined;
  if (!row) return { prevHash: null, prevAtMs: null };
  return {
    prevHash: row.last_fingerprint_hash ?? null,
    prevAtMs: row.last_fingerprint_at_ms ?? null
  };
}

function writeFingerprintState(terminalId: string, newHash: string, nowMs: number): void {
  const db = getIdentityDb();
  db.prepare(`UPDATE terminals
    SET last_fingerprint_hash = ?, last_fingerprint_at_ms = ?
    WHERE id = ?`).run(newHash, nowMs, terminalId);
}

function isPollableTerminal(terminal: TerminalRow): boolean {
  // Skip remote-mapping synthetic terminals (no real pane to capture),
  // skip terminals without an agent_kind (likely human / non-agent),
  // and skip terminals with no tmux_target_pane to capture from
  // (per Locked Acceptance: walk terminals with non-null tmux_target_pane).
  if (terminal.agent_kind === null || terminal.agent_kind === undefined || terminal.agent_kind === 'remote') return false;
  if (terminal.tmux_target_pane === null || terminal.tmux_target_pane === undefined || terminal.tmux_target_pane.length === 0) return false;
  return true;
}

function maxTerminalsPerTick(): number {
  const raw = Number(process.env.ANT_AGENT_STATUS_MAX_TERMINALS_PER_TICK);
  if (!Number.isFinite(raw) || raw <= 0) return POLL_MAX_TERMINALS_DEFAULT;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

function isVolatileAgentStatus(status: AgentStatus): boolean {
  return status === 'working' || status === 'thinking';
}

function defaultTmuxCwdFn(terminal: TerminalRow): string | null {
  const pane = terminal.tmux_target_pane;
  if (!pane) return null;
  const nowMs = Date.now();
  const cached = cwdCache.get(pane);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  try {
    const result = spawnSync(TMUX_BIN, ['display-message', '-p', '-t', pane, '#{pane_current_path}'], {
      timeout: 500
    });
    if (result.status !== 0) {
      cwdCache.set(pane, { value: null, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
      return null;
    }
    const path = (result.stdout?.toString('utf8') ?? '').trim();
    const value = path.length > 0 ? path : null;
    cwdCache.set(pane, { value, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
    return value;
  } catch {
    cwdCache.set(pane, { value: null, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
    return null;
  }
}

// defaultTmuxCaptureFn now lives in ./tmuxCapture (M3.2c B1 cycle break).
// Re-exported above for backwards compat with existing importers.

// M3.2c: detect kind for a NULL-kind terminal once per tick + write back
// (HIGH updates agent_kind+meta; MED/LOW meta-only with B2 hash-debounce).
// Idempotent: only fires when terminal.agent_kind is null/undefined.
// Threads the poller's captureFn so kind-detection sees the same pane bytes
// as state-detection (test injection works end-to-end).
export function classifyIfUnknown(terminal: TerminalRow, captureFn?: CaptureFn): void {
  if (terminal.agent_kind !== null && terminal.agent_kind !== undefined) return;
  const result = detectFingerprint(terminal, captureFn ? { captureFn } : {});
  applyFingerprintWriteBack(terminal, result);
}

async function pollOneTerminal(terminal: TerminalRow, captureFn: CaptureFn): Promise<void> {
  // Phase A3 (JWPK A Team msg_7uvr35x0xr 2026-05-29): per-terminal pane-gone
  // → archived. When the tmux pane is gone (capture-pane exits non-zero),
  // verifyPaneTargetState marks the pane stale; we flip lifecycle status to
  // archived and skip the fingerprint sample entirely (the pane bytes are
  // already gone — no useful signal to derive).
  if (terminal.tmux_target_pane) {
    if (verifyPaneTargetState(terminal) === 'stale') {
      setTerminalStatus(terminal.id, 'archived');
      return;
    }
  }
  const captureText = captureFn(terminal);
  if (captureText === null) return;
  const nowMs = Date.now();
  const { prevHash, prevAtMs } = readFingerprintState(terminal.id);
  const fingerprint = deriveStateFromFingerprint({
    captureText, prevHash, prevAtMs, nowMs
  });
  writeFingerprintState(terminal.id, fingerprint.hash, nowMs);
  const current = getAgentStatus(terminal.id);
  if (!fingerprint.status) return;
  if (current && current.agent_status === fingerprint.status) {
    if (isVolatileAgentStatus(current.agent_status)) {
      refreshAgentStatusAtMs(terminal.id, nowMs);
    }
    return;
  }
  if (
    current &&
    current.agent_status_source === 'hook' &&
    nowMs - current.agent_status_at_ms < HOOK_FRESH_MS
  ) {
    return;
  }
  const decision = decideAgentStatus({
    fingerprint, hookPush: null, antActivity: null, pidCpu: null
  });
  setAgentStatus({
    terminalId: terminal.id,
    newStatus: decision.status,
    source: decision.source,
    evidence: decision.evidence
  });
}

export type StartPollerInput = {
  captureFn?: CaptureFn;
  cwdFn?: (terminal: TerminalRow) => string | null;
  intervalMs?: number;
};

function projectCliStateFileStatus(terminal: TerminalRow, cwdFn?: (terminal: TerminalRow) => string | null): boolean {
  const cwd = cwdFn ? cwdFn(terminal) : null;
  const snapshot = resolveAgentStateSnapshotForTerminal(terminal, cwd);
  const projected = projectLiveAgentStateSnapshotToStatus(snapshot);
  if (!projected) return false;
  const current = getAgentStatus(terminal.id);
  if (current?.agent_status === projected) {
    if (isVolatileAgentStatus(projected)) refreshAgentStatusAtMs(terminal.id);
    return true;
  }
  setAgentStatus({
    terminalId: terminal.id,
    newStatus: projected,
    source: 'hook',
    evidence: {
      stateLabel: snapshot?.stateLabel ?? null,
      sessionId: snapshot?.sessionId ?? null,
      via: 'agent-state-poller'
    }
  });
  return true;
}

export function startPoller(input: StartPollerInput = {}): PollerController {
  const slot = globalThis as Record<string, unknown>;
  const existing = slot[POLLER_GLOBAL_KEY] as PollerController | undefined;
  if (existing && existing.isRunning()) return existing;
  const cadence = clampCadence(input.intervalMs);
  const captureFn: CaptureFn = input.captureFn ?? defaultTmuxCaptureFn;
  const cwdFn = input.cwdFn ?? defaultTmuxCwdFn;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runOnce = async (): Promise<void> => {
    const maxTerminals = maxTerminalsPerTick();
    // M3.2c: classify NULL-kind terminals first so they become pollable in the
    // same tick. B3 lock — per-terminal try/catch so one classify-throw does
    // not block siblings (mirrors the per-terminal isolation on pollOneTerminal).
    for (const terminal of listAllTerminals().slice(0, maxTerminals)) {
      if (terminal.agent_kind !== null && terminal.agent_kind !== undefined) continue;
      try { classifyIfUnknown(terminal, captureFn); } catch { /* isolated per-terminal */ }
    }
    const terminals = listAllTerminals().filter(isPollableTerminal).slice(0, maxTerminals);
    for (const terminal of terminals) {
      try {
        if (projectCliStateFileStatus(terminal, cwdFn)) continue;
        await pollOneTerminal(terminal, captureFn);
      } catch { /* per-terminal failure does not block other terminals */ }
    }
    // Phase A3 (JWPK A Team msg_7uvr35x0xr 2026-05-29): heartbeat sweep for
    // the rows isPollableTerminal SKIPS — remote terminals and terminals
    // without a tmux_target_pane never get sampled by the fingerprint path,
    // so without this pass they'd never archive on their own.
    // 5-min threshold per JWPK design Q3 default A. We use the larger of
    // last_message_sent_at_ms and last_pty_byte_at_ms as "last seen".
    // Skip rows that have never been touched (latest=0) — they're either
    // freshly spawned with no traffic yet, or have no fanout history.
    const remoteOrPaneless = listAllTerminals().filter(
      (t) => t.agent_kind === 'remote' || !t.tmux_target_pane
    );
    const archiveThresholdMs = Date.now() - 5 * 60 * 1000;
    for (const t of remoteOrPaneless) {
      if (t.status === 'archived' || t.status === 'deleted') continue;
      const latest = Math.max(t.last_message_sent_at_ms ?? 0, t.last_pty_byte_at_ms ?? 0);
      if (latest > 0 && latest < archiveThresholdMs) {
        try { setTerminalStatus(t.id, 'archived'); } catch { /* per-terminal failure does not block sweep */ }
      }
    }
  };

  const tick = (): void => { if (!stopped) void runOnce(); };
  timer = setInterval(tick, cadence);
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref();

  const controller: PollerController = {
    stop: () => {
      stopped = true;
      if (timer !== null) { clearInterval(timer); timer = null; }
      delete slot[POLLER_GLOBAL_KEY];
    },
    runOnce,
    isRunning: () => !stopped
  };
  slot[POLLER_GLOBAL_KEY] = controller;
  return controller;
}

export function _testResetPoller(): void {
  const slot = globalThis as Record<string, unknown>;
  const existing = slot[POLLER_GLOBAL_KEY] as PollerController | undefined;
  if (existing) existing.stop();
}
