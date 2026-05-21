/**
 * GET /api/terminals/[id]/agent-state/stream
 *
 * SSE stream of the agentState snapshot for one terminal. Pushes a new
 * frame whenever the snapshot's serialised content changes — drives the
 * status pill (Working / Available / Response needed / etc) without
 * the 15s round-trip lag the polling GET had.
 *
 * Implementation: 250ms server-side poll calling the same resolver the
 * GET endpoint uses (agentStateReader has an mtime cache, so unchanged
 * files are free). When the JSON-serialised snapshot changes, emit a
 * `data: {snapshot}` frame. We pick polling over fs.watch because the
 * resolver may match across multiple candidate dirs (~/.claude/state/
 * + ~/.ant/state/<cli>/) and the "which file is current for this
 * terminal" picks via PID-ancestry — watching the dirs would need
 * extra plumbing for no real benefit at this cadence.
 *
 * Heartbeat every 25s to keep proxies from killing idle connections.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  findStateForSessionId,
  findStateForCwd,
  findStateForCwdBasename,
  type AgentCli,
  type AgentStateSnapshot
} from '$lib/server/agentStateReader';
import { resolveTerminalRecordCliSession } from '$lib/server/terminalSessionLink';
import { getAgentStatus, setAgentStatus, type AgentStatus } from '$lib/server/agentStatusStore';

/** Map the freeform stateLabel from a CLI state file to the projected
 *  enum the room-participant pill reads via terminals.agent_status.
 *  Claude writes capitalised words ("Working", "Available", "Menu");
 *  antigravity writes lowercase enum values directly. Unknown strings
 *  fall back to 'idle' so the pill at least doesn't crash on a new
 *  state label we haven't seen yet. */
function projectStateLabelToAgentStatus(label: string | undefined): AgentStatus {
  if (!label) return 'idle';
  const k = label.trim().toLowerCase();
  if (k === 'working') return 'working';
  if (k === 'thinking') return 'thinking';
  if (k === 'response-required' || k === 'response needed') return 'response-required';
  if (k.startsWith('menu')) return 'response-required';
  if (k === 'available' || k === 'idle' || k === 'waiting') return 'idle';
  return 'idle';
}

const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
// 1s server-side poll — 250ms was hammering the system because each tick
// spawns a tmux subprocess + ps walk per open terminal stream. With N
// open terminals that's ~4N subprocesses/sec which made everything feel
// like treacle. 1s is still 15x faster than the old REST poll and well
// inside human perception for status-pill updates.
const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
// tmuxPaneCurrentPath cache — the cwd doesn't change every tick; cache
// per-pane for 5s so the SSE poll doesn't spawn a tmux subprocess on
// every emission. Cache is process-wide because the stream handler
// recreates per-request.
const CWD_CACHE_TTL_MS = 5_000;
type CwdCacheEntry = { value: string | null; expiresAtMs: number };
const cwdCache = new Map<string, CwdCacheEntry>();

const AGENT_KIND_TO_CLI: Record<string, AgentCli> = {
  'claude': 'claude-code',
  'claude-code': 'claude-code',
  'claude_code': 'claude-code',
  'codex': 'codex-cli',
  'codex-cli': 'codex-cli',
  'gemini': 'gemini-cli',
  'gemini-cli': 'gemini-cli',
  'qwen': 'qwen-cli',
  'qwen-cli': 'qwen-cli',
  'pi': 'pi',
  'copilot': 'copilot-cli',
  'copilot-cli': 'copilot-cli',
  'agy': 'antigravity',
  'antigravity': 'antigravity'
};

function tmuxPaneCurrentPath(pane: string): string | null {
  if (!pane) return null;
  const nowMs = Date.now();
  const cached = cwdCache.get(pane);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  try {
    const r = spawnSync(TMUX_BIN, [
      'display-message', '-p', '-t', pane, '#{pane_current_path}'
    ], { timeout: 500 });
    if (r.status !== 0) {
      cwdCache.set(pane, { value: null, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
      return null;
    }
    const path = (r.stdout?.toString('utf8') ?? '').trim();
    const value = path.length > 0 ? path : null;
    cwdCache.set(pane, { value, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
    return value;
  } catch {
    cwdCache.set(pane, { value: null, expiresAtMs: nowMs + CWD_CACHE_TTL_MS });
    return null;
  }
}

function resolveSnapshot(terminalId: string): AgentStateSnapshot | null {
  const record = getTerminalRecord(terminalId);
  if (!record || !record.agent_kind) return null;
  const cli = AGENT_KIND_TO_CLI[record.agent_kind];
  if (!cli) return null;

  // Prefer the PID-disambiguated link (works once write-state.sh has
  // started writing pid into state files). Falls back to the same
  // sessionId/cwd/basename chain the GET endpoint uses, so existing
  // CLIs whose hooks haven't been updated still light up via cwd.
  const cwd = record.tmux_target_pane
    ? tmuxPaneCurrentPath(record.tmux_target_pane)
    : null;
  const linked = resolveTerminalRecordCliSession(record, cwd ? { cwd } : {});
  if (linked?.snapshot) return linked.snapshot;

  let snapshot = findStateForSessionId(cli, terminalId);
  if (!snapshot && cwd) {
    snapshot = findStateForCwd(cli, cwd) ?? findStateForCwdBasename(cli, basename(cwd));
  }
  return snapshot ?? null;
}

export const GET: RequestHandler = ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastSerialised = '';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      const emitIfChanged = () => {
        try {
          const snap = resolveSnapshot(sessionId);
          const payload = JSON.stringify({ snapshot: snap });
          if (payload === lastSerialised) return;
          lastSerialised = payload;
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));

          // Also project the new state into terminals.agent_status so the
          // room-participant pill (which reads from that column via
          // /api/chat-rooms/[id]/agent-statuses) stays in sync without
          // its own SSE plumbing. ParticipantsPanel polls every 30s AND
          // refreshes on agent_activity events, so this write is the
          // single upstream that lights both pills at once. No-op when
          // the projected status hasn't changed (mirrors agentStatusPoller).
          if (snap) {
            const projected = projectStateLabelToAgentStatus(snap.stateLabel);
            const current = getAgentStatus(sessionId);
            if (!current || current.agent_status !== projected) {
              setAgentStatus({
                terminalId: sessionId,
                newStatus: projected,
                source: 'hook',
                evidence: { stateLabel: snap.stateLabel ?? null, via: 'agent-state-stream' }
              });
            }
          }
        } catch {
          // Resolver / stream failure — fall silent for this tick; the
          // next tick (or the heartbeat) will surface the error if the
          // connection is still alive.
        }
      };

      // First emission: the current snapshot, immediately.
      emitIfChanged();

      poll = setInterval(emitIfChanged, POLL_INTERVAL_MS);
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { if (heartbeat) clearInterval(heartbeat); }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      if (poll) clearInterval(poll);
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive'
    }
  });
};
