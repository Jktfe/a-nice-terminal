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

export async function handleStatusVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === 'chasing') return handleStatusChasingVerb(args, runtime, ctx);
  if (action === 'planning') return runPlanning(args, runtime, CliInputError);
  if (action === 'idle') return runSetCurrentStatus('idle', args, runtime, CliInputError);
  const flags = parseFlags(args, CliInputError);
  if (action === 'show') return runShow(flags, runtime, CliInputError);
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant status show --room ROOM_ID [--rich] [--json]  OR  ant status show --terminal TERMINAL_ID --rich [--json]');
    runtime.writeOut('ant status planning [--room ROOM_ID] [--msg TEXT] [--json]');
    runtime.writeOut('ant status idle [--json]');
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
  const payload = await sendJson(runtime, '/api/identity/resolve', 'POST', { pids: pidChain });
  const terminalId = payload?.terminal_id ?? payload?.terminalId ?? null;
  if (!terminalId) {
    throw new Error('current pidChain did not resolve to a terminal; run `ant register` from this shell first');
  }
  return terminalId;
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

async function fetchJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
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
  const queryParam = rich ? '?rich=1' : '';
  const path = `/api/chat-rooms/${encodeURIComponent(roomId)}/status${queryParam}`;
  const payload = await fetchJson(runtime, path);

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
