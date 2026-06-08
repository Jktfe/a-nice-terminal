/**
 * ant status — pane/terminal delivery status surface (M3.4a-v1) + rich agent
 * status (M3.4a-v2, --rich flag per Q8 lock).
 *
 * Subverb: show — list pane_status per room member (v1) OR rich agent_status
 * per terminal (--rich --terminal) OR both together (--rich --room future).
 *
 * v1 surfaces existing terminals.pane_status (verified/stale/unknown).
 * v2 rich agent_status enum is idle/thinking/working/response-required (per
 * JWPK FL2 2026-05-13 + M3.4a-v2 design contract 2026-05-14).
 */

const BOOLEAN_FLAGS = new Set(['json', 'rich']);

import { handleStatusChasingVerb } from './ant-cli-status-chasing.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { copyFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export async function handleStatusVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === 'chasing') return handleStatusChasingVerb(args, runtime, ctx);
  if (action === 'planning') return runPlanning(args, runtime, CliInputError);
  if (action === 'idle') return runSetCurrentStatus('idle', args, runtime, CliInputError);
  if (action === 'install-line') return runInstallLine(args, runtime, CliInputError);
  const flags = parseFlags(args, CliInputError);
  if (action === 'show') return runShow(flags, runtime, CliInputError);
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant status show --room ROOM_ID [--rich] [--json]  OR  ant status show --terminal TERMINAL_ID --rich [--json]');
    runtime.writeOut('ant status planning [--room ROOM_ID] [--msg TEXT] [--json]');
    runtime.writeOut('ant status idle [--json]');
    runtime.writeOut('ant status install-line --cli qwen-cli [--target PATH] [--json]');
    runtime.writeOut('ant status chasing --handle @h [--min-idle-minutes 30] [--json]');
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown status verb: ${action}`);
}

async function sendJson(runtime, path, method, body) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function resolveCurrentTerminal(runtime, pidChain) {
  const sessionId = durableSessionIdForRuntime(runtime);
  const payload = await sendJson(
    runtime,
    '/api/identity/resolve',
    'POST',
    sessionId ? { pids: pidChain, sessionId } : { pids: pidChain }
  );
  const terminalId = payload?.terminal_id ?? payload?.terminalId ?? null;
  if (!terminalId) {
    throw new Error('current pidChain did not resolve to a terminal; run `ant register` from this shell first');
  }
  return terminalId;
}

function normaliseDurableSessionId(raw) {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function durableSessionIdForRuntime(runtime) {
  const envSession = normaliseDurableSessionId(process.env.ANT_SESSION_ID);
  if (envSession) return envSession;
  const pane =
    normaliseDurableSessionId(runtime.envTmuxPane) ??
    normaliseDurableSessionId(process.env.TMUX_PANE) ??
    normaliseDurableSessionId(process.env.WEZTERM_PANE);
  const byPane = runtime.config?.antSessions?.byPane;
  if (pane && byPane && typeof byPane === 'object') {
    const paneSession = normaliseDurableSessionId(byPane[pane]);
    if (paneSession) return paneSession;
  }
  return null;
}

function durableSessionHeaders(runtime) {
  const sessionId = durableSessionIdForRuntime(runtime);
  return sessionId ? { 'x-ant-session-id': sessionId } : {};
}

async function runPlanning(args, runtime, CliInputError) {
  const flags = parseFlags(args, CliInputError);
  const message = (flags.msg ?? flags.message ?? 'going into planning mode').trim();
  const result = await setCurrentAgentStatus({
    status: 'thinking',
    mode: 'planning',
    flags,
    runtime,
    evidence: { mode: 'planning', message }
  });
  if (flags.room) {
    await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(flags.room)}/messages`, 'POST', {
      body: message,
      pidChain: result.pidChain
    });
  }
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result.payload));
  } else {
    runtime.writeOut(`planning\t${result.terminalId}`);
  }
  return 0;
}

async function runSetCurrentStatus(status, args, runtime, CliInputError) {
  const flags = parseFlags(args, CliInputError);
  const result = await setCurrentAgentStatus({
    status,
    mode: status,
    flags,
    runtime,
    evidence: { mode: status }
  });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result.payload));
  } else {
    runtime.writeOut(`${status}\t${result.terminalId}`);
  }
  return 0;
}

async function runInstallLine(args, runtime, CliInputError) {
  const flags = parseFlags(args, CliInputError);
  const cli = normalizeInstallLineCli(requireFlag(flags, 'cli', CliInputError), CliInputError);
  const targetPath = resolve(flags.target ?? defaultStatusLineTarget(cli));
  const template = statusLineTemplateForCli(cli);
  let backupPath = null;
  let installed = true;
  let alreadyInstalled = false;

  if (existsSync(targetPath)) {
    const current = await readFile(targetPath, 'utf8').catch(() => null);
    if (current === template) {
      installed = false;
      alreadyInstalled = true;
    } else {
      backupPath = `${targetPath}.bak-pre-ant-statusline`;
      if (!existsSync(backupPath)) {
        await copyFile(targetPath, backupPath);
      }
    }
  }

  if (installed) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, template, 'utf8');
    await chmod(targetPath, 0o755);
  }

  const payload = { cli, targetPath, installed, alreadyInstalled, backupPath };
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else if (alreadyInstalled) {
    runtime.writeOut(`${cli} status line already installed at ${targetPath}`);
  } else {
    runtime.writeOut(`Installed ${cli} status line at ${targetPath}`);
    if (backupPath) runtime.writeOut(`Backup: ${backupPath}`);
  }
  return 0;
}

function normalizeInstallLineCli(rawCli, CliInputError) {
  const cli = rawCli.trim();
  if (cli === 'qwen' || cli === 'qwen-cli') return 'qwen-cli';
  throw new CliInputError('only qwen-cli is supported by status install-line pilot');
}

function defaultStatusLineTarget(cli) {
  if (cli === 'qwen-cli') return join(homedir(), '.qwen', 'statusline-command.sh');
  throw new Error(`Unsupported status-line CLI: ${cli}`);
}

function statusLineTemplateForCli(cli) {
  if (cli !== 'qwen-cli') throw new Error(`Unsupported status-line CLI: ${cli}`);
  return QWEN_STATUSLINE_TEMPLATE;
}

const QWEN_STATUSLINE_TEMPLATE = `#!/bin/bash
# ANT qwen-cli status line pilot.
# Keeps Qwen's visible status text, and also writes ANT-canonical state JSON
# to ~/.ant/state/qwen-cli/<sessionId>.json for agentStateReader.

input=$(cat)

requests=$(echo "$input" | jq '[.metrics.models | to_entries[].value.api.total_requests] | add // 0' 2>/dev/null)
errors=$(echo "$input" | jq '[.metrics.models | to_entries[].value.api.total_errors] | add // 0' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // .session.id // .conversation_id // .id // "qwen-statusline"' 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)

requests=\${requests:-0}
errors=\${errors:-0}
session_id=\${session_id:-qwen-statusline}

if [ "$errors" -gt 0 ]; then
  visible_status="Error"
  ant_state="Response needed"
elif [ "$requests" -eq 0 ]; then
  visible_status="Idle"
  ant_state="Available"
elif [ $((requests % 2)) -ne 0 ]; then
  visible_status="Working"
  ant_state="Working"
elif [ "$requests" -ge 4 ]; then
  visible_status="Complete"
  ant_state="Waiting"
else
  visible_status="Needs Input"
  ant_state="Response needed"
fi

state_dir="\${ANT_STATE_DIR:-$HOME/.ant/state/qwen-cli}"
mkdir -p "$state_dir" 2>/dev/null || true
safe_session=$(printf "%s" "$session_id" | tr -c 'A-Za-z0-9._-' '_')
state_file="$state_dir/$safe_session.json"
tmp_file="$state_file.tmp"
now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ -f "$state_file" ]; then
  session_start=$(jq -r '.session_start // empty' "$state_file" 2>/dev/null)
else
  session_start=""
fi
session_start=\${session_start:-$now}

jq -n \\
  --arg state "$ant_state" \\
  --arg session_start "$session_start" \\
  --arg cwd "$cwd" \\
  --arg last_edit_ts "$now" \\
  --arg visible_status "$visible_status" \\
  --argjson requests "$requests" \\
  --argjson errors "$errors" \\
  '{
    state: $state,
    session_start: $session_start,
    cwd: $cwd,
    last_edit_ts: $last_edit_ts,
    qwen_visible_status: $visible_status,
    qwen_requests: $requests,
    qwen_errors: $errors
  }' > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$state_file" 2>/dev/null || true

echo "$visible_status"
`;

async function setCurrentAgentStatus({ status, mode, flags, runtime, evidence }) {
  const terminalIdFromFlag = flags.terminal;
  const pidChain = processIdentityChain();
  const terminalId = terminalIdFromFlag ?? await resolveCurrentTerminal(runtime, pidChain);
  const payload = await sendJson(
    runtime,
    `/api/terminals/${encodeURIComponent(terminalId)}/agent-status`,
    'PUT',
    {
      status,
      pids: pidChain,
      evidence_json: { ...evidence, source: `ant status ${mode}` }
    }
  );
  return { terminalId, pidChain, payload };
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
}

async function fetchJson(runtime, path, extraHeaders = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    headers: { ...extraHeaders }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function runShow(flags, runtime, CliInputError) {
  const rich = flags.rich !== undefined;
  const room = flags.room;
  const terminal = flags.terminal;
  if (room && terminal) throw new CliInputError('cannot pass both --room and --terminal');
  if (!room && !terminal) throw new CliInputError('missing required flag --room (or --terminal with --rich)');
  if (terminal && !rich) throw new CliInputError('--terminal requires --rich (M3.4a-v2 rich agent status surface)');

  if (terminal) return runTerminalRich(terminal, flags, runtime);
  return runRoom(room, rich, flags, runtime);
}

async function runTerminalRich(terminalId, flags, runtime) {
  const path = `/api/terminals/${encodeURIComponent(terminalId)}/agent-status`;
  const payload = await fetchJson(runtime, path);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const prefix = (payload.terminal_id ?? '').slice(0, 8);
  const sinceText = typeof payload.since_ms === 'number'
    ? formatRelativeMs(payload.since_ms)
    : 'never';
  runtime.writeOut(`${prefix}\t${payload.agent_status}\t(source: ${payload.agent_status_source}, since ${sinceText})`);
  return 0;
}

async function runRoom(roomId, rich, flags, runtime) {
  // Room-scoped GET — append pidChain for the hooks.server.ts gate.
  // Same pattern as ant-cli-chat-pending (24fba92) and PR #61 rooms members.
  const query = new URLSearchParams({ pidChain: JSON.stringify(processIdentityChain()) });
  if (rich) query.set('rich', '1');
  const path = `/api/chat-rooms/${encodeURIComponent(roomId)}/status?${query.toString()}`;
  const payload = await fetchJson(runtime, path, durableSessionHeaders(runtime));

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }

  const members = payload.members ?? [];
  if (members.length === 0) {
    runtime.writeOut(`(no members in room ${payload.roomId})`);
    return 0;
  }
  for (const m of members) {
    const terminalPrefix = (m.terminal_id ?? '').slice(0, 8);
    const ageNote = ageFromTimestamp(m.pane_status, m.pane_stale_since, m.updated_at);
    const richNote = rich && m.agent_status ? `\t[${m.agent_status}/${m.agent_status_source}]` : '';
    runtime.writeOut(`${m.handle}\t${terminalPrefix}\t${m.pane_status}${ageNote}${richNote}`);
  }
  return 0;
}

function formatRelativeMs(ms) {
  if (typeof ms !== 'number' || ms < 0) return 'unknown';
  if (ms < 1000) return `${ms}ms ago`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function ageFromTimestamp(paneStatus, paneStaleSince, updatedAt) {
  if (paneStatus === 'stale' && typeof paneStaleSince === 'number') {
    return ` (stale since ${formatRelative(paneStaleSince)})`;
  }
  if (typeof updatedAt === 'number') {
    return ` (last seen ${formatRelative(updatedAt)})`;
  }
  return '';
}

function formatRelative(unixSeconds) {
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}
