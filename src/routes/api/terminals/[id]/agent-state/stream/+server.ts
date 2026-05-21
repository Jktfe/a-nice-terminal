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

const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const POLL_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 25_000;

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
  try {
    const r = spawnSync(TMUX_BIN, [
      'display-message', '-p', '-t', pane, '#{pane_current_path}'
    ], { timeout: 500 });
    if (r.status !== 0) return null;
    const path = (r.stdout?.toString('utf8') ?? '').trim();
    return path.length > 0 ? path : null;
  } catch { return null; }
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
