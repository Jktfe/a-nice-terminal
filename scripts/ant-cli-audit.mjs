/**
 * ant audit — per-room permissions audit surface (M3.1a).
 *
 * Subverb: permissions — list every member of a room with their identity proof.
 *
 * v1 reads the room_memberships -> terminals join via /api/chat-rooms/:roomId/audit.
 * No write side. last_activity_at is excluded from v1.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleAuditVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  if (action === 'permissions') return runPermissions(flags, runtime, CliInputError);
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant audit permissions --room ROOM_ID [--json]');
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown audit verb: ${action}`);
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

async function runPermissions(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  // Room-scoped GET — hooks.server.ts gateChatRoomReadApi requires the
  // caller to thread pidChain (or admin-bearer). Local fetchJson doesn't
  // auto-add identity, so the sender appends it explicitly. Same shape
  // as @speedycodex chat-pending fix (24fba92) and PR #61 rooms members.
  const query = new URLSearchParams({ pidChain: JSON.stringify(processIdentityChain()) });
  const path = `/api/chat-rooms/${encodeURIComponent(room)}/audit?${query.toString()}`;
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
    const name = m.terminal_name ?? '(no-name)';
    const joinedAgo = formatRelative(m.joined_at);
    runtime.writeOut(`${m.handle}\t${terminalPrefix}\t${name}\t(joined ${joinedAgo})`);
  }
  return 0;
}

function formatRelative(unixSeconds) {
  if (typeof unixSeconds !== 'number') return 'unknown';
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}
