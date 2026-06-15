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
 *   - pane-label re-promotion (source 'pane'): when a label CLI's own
 *     status strip reads Working/thinking AND the pane tail changed within
 *     30s, an 'idle' status is promoted back to 'working' so background
 *     work after a Stop hook still presents as working. See pollOneTerminal.
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
import { parsePaneState, type CliKind as PaneCliKind } from './paneStatusParser';
import { detectFingerprint, applyFingerprintWriteBack } from './fingerprintDetector';
import { defaultTmuxCaptureFn, type CaptureFn } from './tmuxCapture';
import { verifyPaneTargetState } from './pty-inject-bridge';
import { reconcileBindingsAtBoot } from './bindingBootReconcile';
import { sweepExpiredProxyBindings } from './handleBindingsStore';
import { getIdentityDb } from './db';
import { spawnSync } from 'node:child_process';
import {
  projectLiveAgentStateSnapshotToStatus,
  resolveAgentStateSnapshotForTerminal
} from './agentStateProjection';
import { TMUX_BIN } from './tmuxBin';
export { defaultTmuxCaptureFn };
export type { CaptureFn };

const POLL_MIN_MS = 5_000;
const POLL_MAX_MS = 60_000;
const POLL_DEFAULT_MS = 10_000;
const POLL_MAX_TERMINALS_DEFAULT = 5;
const HOOK_FRESH_MS = 30_000;
// Stop-drop backstop window. A volatile (working/thinking) status with NO
// fresh evidence of activity (status write / pty bytes / chat message) for
// this long is treated as a lost Stop event and decayed to idle. See
// reconcileStaleVolatileStatuses. Kept tight (45s) so a stopped agent's ant
// stops crawling promptly — the evidence-max guard prevents false-idling a
// genuinely-busy agent mid-operation.
const STALE_VOLATILE_DECAY_DEFAULT_MS = 45_000;
const CWD_CACHE_TTL_MS = 5_000;

type CwdCacheEntry = { value: string | null; expiresAtMs: number };
const cwdCache = new Map<string, CwdCacheEntry>();

// Pane-label re-promotion state (feat/status-cascade 2026-06-10, "ant goes
// static while background work runs"). Per-terminal tail hash + the last time
// it CHANGED. In-memory only — the poller is a globalThis singleton, so a
// server restart costs exactly one missed sample (the first tick re-seeds).
type PaneTailEntry = { tailHash: string; lastTailChangeAtMs: number };
const paneTailState = new Map<string, PaneTailEntry>();

/**
 * agent_kind → paneStatusParser CliKind. Mirrors agentKindToCli
 * (terminalSessionLink.ts) but targets the parser's kind enum. gemini has no
 * pane-label grammar in paneStatusParser, so it maps to null (safe default:
 * keeps today's behaviour). Label-less kinds (agy/copilot/pi) ARE mapped —
 * they can never promote (promotion requires parse.source === 'label') but
 * tracking their tails is harmless and keeps the map total.
 */
export function agentKindToPaneCliKind(agentKind: string | null | undefined): PaneCliKind | null {
  switch (agentKind) {
    case 'claude':
    case 'claude-code':
    case 'claude_code':
      return 'claude';
    case 'codex':
    case 'codex-cli':
      return 'codex';
    case 'qwen':
    case 'qwen-cli':
      return 'qwen';
    case 'agy':
    case 'antigravity':
      return 'agy';
    case 'copilot':
    case 'copilot-cli':
      return 'copilot';
    case 'pi':
      return 'pi';
    default:
      return null;
  }
}

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

function staleVolatileDecayMs(): number {
  const raw = Number(process.env.ANT_AGENT_STATUS_STALE_DECAY_MS);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : STALE_VOLATILE_DECAY_DEFAULT_MS;
  // Never decay faster than the hook-fresh window or we'd undo a still-fresh
  // hook write before the fingerprint/hook paths get a chance to re-confirm it.
  return Math.max(HOOK_FRESH_MS, requested);
}

/**
 * reconcileStaleVolatileStatuses — the Stop-drop backstop (JWPK, Agents Agents
 * 2026-06-10: "you'd stopped but your ant didn't").
 *
 * agent_status flips to working/thinking via a hook POST (or the agent-state
 * SSE projection), but the Stop hook that should flip it back to idle is
 * FIRE-AND-FORGET (curl … || true to prod :6174). On any server blip the Stop
 * POST silently drops and nothing ever clears the volatile status — the agent
 * "crawls" forever.
 *
 * Status truth must not depend on a single best-effort POST landing. This
 * sweep decays a volatile status to idle once NO liveness signal has advanced
 * for the decay window.
 *
 * Critically it keys on the freshest EVIDENCE of activity, not the status-WRITE
 * time alone: a long single operation (e.g. a 3-minute build) writes 'working'
 * exactly once at the start but keeps streaming pty bytes the whole time, so
 * keying on agent_status_at_ms alone would falsely idle a genuinely-busy agent
 * mid-op. We take max(status write, last pty byte, last chat message) and only
 * decay when ALL of them have gone quiet — that distinguishes "stopped" from
 * "mid long-running tool". (The fingerprint path also refreshes the status
 * write for actively-sampled paned terminals; this is the broader backstop for
 * the SSE/hook-driven and remote/paneless terminals it does not sample.)
 *
 * Sweeps ALL live terminals (not the per-tick fingerprint slice) because the
 * stuck terminal may not be in the sampled window. Per-terminal isolation so
 * one bad write does not abort the sweep.
 */
export function reconcileStaleVolatileStatuses(nowMs: number = Date.now()): void {
  const decayMs = staleVolatileDecayMs();
  for (const terminal of listAllTerminals()) {
    if (terminal.status !== 'live') continue;
    const status = terminal.agent_status;
    if (!status || !isVolatileAgentStatus(status)) continue;
    const lastEvidenceMs = Math.max(
      terminal.agent_status_at_ms ?? 0,
      terminal.last_pty_byte_at_ms ?? 0,
      terminal.last_message_sent_at_ms ?? 0
    );
    if (lastEvidenceMs <= 0) continue;
    const staleForMs = nowMs - lastEvidenceMs;
    if (staleForMs < decayMs) continue;
    try {
      setAgentStatus({
        terminalId: terminal.id,
        newStatus: 'idle',
        source: 'default',
        nowMs,
        evidence: {
          via: 'stale-volatile-decay',
          decayedFrom: status,
          previousSource: terminal.agent_status_source ?? null,
          staleForMs,
          decayWindowMs: decayMs
        }
      });
    } catch { /* per-terminal failure does not block the sweep */ }
  }
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
  // Fingerprint chain state updates EVERY tick — even when the pane-label
  // promotion below early-returns — so the change-detection ageMs stays
  // anchored to the poll cadence and a later fall-through tick cannot
  // misread a multi-minute-old hash timestamp as "stale pane".
  const { prevHash, prevAtMs } = readFingerprintState(terminal.id);
  let fingerprint = deriveStateFromFingerprint({
    captureText, prevHash, prevAtMs, nowMs
  });
  writeFingerprintState(terminal.id, fingerprint.hash, nowMs);
  // Pane-label re-promotion (feat/status-cascade 2026-06-10): a Stop hook
  // flips the status to idle even while background work (subagents, queued
  // harness tasks) keeps streaming into the pane. The CLI's own status-strip
  // label ("Working") is the CLI's rendered assertion — same trust tier as a
  // hook event — so while the label says working AND the pane tail is still
  // churning, re-promote idle → working. STRICTLY one-directional:
  //   • only fires when the current status is 'idle' (a hook 'working' is
  //     never demoted, and Stop-written idle with a quiet pane stays idle);
  //   • only on parse.source === 'label' — the streaming-diff 'stream' source
  //     is exactly the tail -f / chatty-shell false positive and NEVER promotes;
  //   • requires the tail to have changed within HOOK_FRESH_MS — a crashed CLI
  //     frozen displaying 'Working' stops re-promoting after 30s of unchanged
  //     tail and the 45s stale-volatile backstop decays it to idle.
  // While promoted (source === 'pane'), refresh agent_status_at_ms each tick
  // the label still reads working and the tail is fresh, so the decay sweep
  // does not idle a genuinely-busy agent mid-run. When the work ends the
  // progress tree freezes + the strip flips to Waiting → refreshes stop → the
  // existing 45s backstop decays to idle. Zero new decay machinery.
  const paneKind = agentKindToPaneCliKind(terminal.agent_kind);
  if (paneKind) {
    const prevTail = paneTailState.get(terminal.id);
    const parse = parsePaneState(paneKind, captureText, prevTail?.tailHash ?? null);
    const tailChanged = prevTail === undefined || prevTail.tailHash !== parse.tailHash;
    const lastTailChangeAtMs = tailChanged || prevTail === undefined ? nowMs : prevTail.lastTailChangeAtMs;
    paneTailState.set(terminal.id, { tailHash: parse.tailHash, lastTailChangeAtMs });
    const tailFresh = nowMs - lastTailChangeAtMs < HOOK_FRESH_MS;
    const labelSaysBusy = parse.source === 'label' && (parse.state === 'working' || parse.state === 'thinking');
    if (labelSaysBusy && tailFresh) {
      const beforePane = getAgentStatus(terminal.id);
      if (beforePane?.agent_status === 'idle') {
        setAgentStatus({
          terminalId: terminal.id,
          newStatus: 'working',
          source: 'pane',
          nowMs,
          evidence: {
            via: 'pane-label-promotion',
            label: parse.evidence,
            paneState: parse.state,
            tailChangedAgoMs: nowMs - lastTailChangeAtMs
          }
        });
        return;
      }
      if (
        beforePane &&
        beforePane.agent_status_source === 'pane' &&
        isVolatileAgentStatus(beforePane.agent_status)
      ) {
        refreshAgentStatusAtMs(terminal.id, nowMs);
        return;
      }
    }
    // Symmetric to the promotion above: the CLI's status strip is an
    // authoritative self-report in BOTH directions. When it explicitly reads
    // idle/Ready (codex "· Ready", Claude "waiting"), trust that over the
    // fingerprint heuristic. Without this, a switched-off / idle pane whose
    // leftover tool markers (⏺/🔧/→) sit frozen on screen while an animated
    // "Worked for Xs" timer keeps ticking the tail hash false-positives as
    // 'working' (JWPK 2026-06-15: dumb terminals "crawling" with nothing that
    // actually evidences work). Neutralise the fingerprint guess to idle; the
    // cascade below still lets a FRESH hook win, so a genuinely-busy agent
    // mid-tool-call is unaffected.
    const labelSaysIdle = parse.source === 'label' && parse.state === 'idle';
    if (labelSaysIdle && fingerprint.status && fingerprint.status !== 'idle') {
      // The strip's explicit idle/Ready beats the fingerprint guess. Override
      // only the status (evidence keeps its typed shape); the demote is then
      // resolved by the cascade below, which still protects a fresh hook.
      fingerprint = { ...fingerprint, status: 'idle' };
    }
  }
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
  /**
   * AC3 Step 1 witness: one-shot boot reconciliation of handle_bindings
   * against `tmux list-panes -a` (the powercut case — daemon and panes died
   * together, nobody witnessed it). Injectable for tests; defaults to the
   * real reconcile. Runs exactly once per poller lifecycle, never on the
   * re-entrant start of an already-running poller, and a failure never
   * blocks the poller from starting.
   */
  bootReconcileFn?: () => unknown;
};

function projectCliStateFileStatus(terminal: TerminalRow, cwdFn?: (terminal: TerminalRow) => string | null): boolean {
  const cwd = cwdFn ? cwdFn(terminal) : null;
  const snapshot = resolveAgentStateSnapshotForTerminal(terminal, cwd);
  const projected = projectLiveAgentStateSnapshotToStatus(snapshot);
  if (!projected) return false;
  // An idle state-file projection must NOT pin idle past fresher pane
  // evidence (feat/status-cascade 2026-06-10): the status-line emitter writes
  // its label at Stop and stays "Waiting" while background work keeps the
  // pane busy. Returning false here (no write, no short-circuit) lets the
  // pane-label step in pollOneTerminal look; if the pane also reads idle,
  // the fingerprint/default path (or the 45s decay backstop) lands idle as
  // before. Volatile + response-required projections keep the short-circuit.
  if (projected === 'idle') return false;
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
  const bootReconcile = input.bootReconcileFn ?? (() => reconcileBindingsAtBoot());
  try { bootReconcile(); } catch { /* witness pass is best-effort at boot */ }
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
    // Stop-drop backstop: decay any volatile status whose last write has gone
    // stale (a dropped fire-and-forget Stop POST) back to idle. Runs LAST so a
    // fingerprint/hook refresh earlier this tick already kept active terminals
    // fresh — only genuinely-stuck statuses remain to be decayed.
    try { reconcileStaleVolatileStatuses(); } catch { /* sweep isolation */ }
    // Proxy death-witness: pane-less bindings are assertions and decay past
    // their TTL (fClaude punch-list 2026-06-12) — observation-witnessed
    // bindings are owned by the pane diff, never this sweep.
    try { sweepExpiredProxyBindings(); } catch { /* sweep isolation */ }
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
  paneTailState.clear();
}

/**
 * Test seam: seed the in-memory pane-tail state so the tail-staleness gate
 * (lastTailChangeAtMs) can be exercised without fast-forwarding Date.now().
 */
export function _testSeedPaneTailState(
  terminalId: string,
  entry: { tailHash: string; lastTailChangeAtMs: number }
): void {
  paneTailState.set(terminalId, entry);
}
