#!/usr/bin/env node
/**
 * ant — small CLI driving the ANT vNext server from a terminal via fetch.
 * Default target http://127.0.0.1:6174 (override with ANT_SERVER_URL).
 * Sub-verbs dispatched to ./ant-cli-<verb>.mjs handlers. Tests mock fetch
 * and capture stdout/stderr. 9-year-old-readable; stay under 260 lines.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { resolveCliVersion } from './ant-cli-version-helper.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DEFAULT_SERVER_URL = process.env.ANT_SERVER_URL ?? 'http://127.0.0.1:6174';

const REGISTER_MODULE = './ant-cli-register.mjs';
const DISPATCH = {
  plan: './ant-cli-plan.mjs', invite: './ant-cli-invites.mjs', chat: './ant-cli-chat.mjs', room: './ant-cli-room.mjs',
  reaction: './ant-cli-reaction.mjs', status: './ant-cli-status.mjs', delivery: './ant-cli-delivery.mjs', audit: './ant-cli-audit.mjs', docs: './ant-cli-docs.mjs',
  decks: './ant-cli-decks.mjs', remote: './ant-cli-remote.mjs', 'remote-room': './ant-cli-remote.mjs', discussion: './ant-cli-discussion.mjs', linkedchat: './ant-cli-linkedchat.mjs', fingerprint: './ant-cli-fingerprint.mjs', mcp: './ant-cli-mcp.mjs', chair: './ant-cli-chair.mjs', interview: './ant-cli-interview.mjs', screenshot: './ant-cli-screenshot.mjs', hooks: './ant-cli-hooks.mjs', new: './ant-cli-new.mjs', list: './ant-cli-list.mjs', terminal: './ant-cli-terminal.mjs', settings: './ant-cli-settings.mjs', flag: './ant-cli-flag.mjs', task: './ant-cli-task.mjs', memory: './ant-cli-memory.mjs', sessions: './ant-cli-sessions.mjs', voice: './ant-cli-voice.mjs', tunnel: './ant-cli-tunnel.mjs', pairing: './ant-cli-pairing.mjs', agents: './ant-cli-agents.mjs', share: './ant-cli-share.mjs', identity: './ant-cli-identity.mjs', register: REGISTER_MODULE, add: REGISTER_MODULE, resolve: REGISTER_MODULE
};

export function makeCliRunner({ fetchImpl, writeOut, writeErr, serverUrl } = {}) {
  const runtime = {
    fetchImpl: fetchImpl ?? globalThis.fetch.bind(globalThis),
    writeOut: writeOut ?? ((line) => console.log(line)),
    writeErr: writeErr ?? ((line) => console.error(line)),
    serverUrl: serverUrl ?? DEFAULT_SERVER_URL
  };

  async function run(argv) {
    const [primaryVerb, secondaryVerb, ...rest] = argv;
    if (!primaryVerb || primaryVerb === 'help' || primaryVerb === '--help') {
      printUsage(runtime);
      return 0;
    }
    if (primaryVerb === '--version' || primaryVerb === 'version') {
      runtime.writeOut(`ant ${resolveCliVersion()}`);
      return 0;
    }
    if (primaryVerb !== 'rooms' && !DISPATCH[primaryVerb]) { printUsage(runtime); return 1; }
    try {
      if (DISPATCH[primaryVerb]) {
        const m = await import(DISPATCH[primaryVerb]);
        const handlerKey = `handle${primaryVerb.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')}Verb`;
        const fn = m[handlerKey];
        return await fn(secondaryVerb, rest, runtime, { CliInputError });
      }
      return await handleRoomsVerb(secondaryVerb, rest, runtime);
    } catch (causeOfFailure) {
      if (causeOfFailure instanceof CliInputError) {
        runtime.writeErr(`Error: ${causeOfFailure.message}`);
        printUsage(runtime);
        return 1;
      }
      runtime.writeErr(formatCallFailure(causeOfFailure));
      return 1;
    }
  }

  return { run };
}

class CliInputError extends Error {}
class CliNetworkError extends Error {}

function stripFlags(rawArgs) {
  const positionals = [];
  for (let i = 0; i < rawArgs.length;) {
    const token = rawArgs[i];
    if (token?.startsWith('--')) {
      // Skip the flag and its value (unless next token is also a flag or missing)
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 2;
      else i += 1;
      continue;
    }
    positionals.push(token);
    i += 1;
  }
  return positionals;
}

async function handleRoomsVerb(action, args, runtime) {
  switch (action) {
    case 'list':
      return listRooms(runtime);
    case 'create':
      return createRoom(stripFlags(args).join(' '), runtime);
    case 'members':
      return listMembers(stripFlags(args)[0], runtime);
    case 'invite':
      return inviteAgent(stripFlags(args)[0], stripFlags(args)[1], runtime);
    case 'post': {
      const postArgs = stripFlags(args);
      return postMessage(postArgs[0], postArgs.slice(1).join(' '), runtime);
    }
    case 'break': {
      const breakArgs = stripFlags(args);
      return postBreak(breakArgs[0], breakArgs.slice(1).join(' '), runtime);
    }
    case 'messages':
      return listMessages(stripFlags(args)[0], runtime);
    default:
      printUsage(runtime);
      return 1;
  }
}

async function listRooms(runtime) {
  const response = await fetchFromServer(runtime, '/api/chat-rooms');
  await throwIfNotOk(response);
  const body = await response.json();
  for (const room of body.chatRooms ?? []) {
    runtime.writeOut(`${room.id}\t${room.name}\t(${room.members.length} members)`);
  }
  return 0;
}

async function createRoom(name, runtime) {
  const trimmedName = (name ?? '').trim();
  if (trimmedName.length === 0) throw new CliInputError('rooms create needs a name');
  const response = await fetchFromServer(runtime, '/api/chat-rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: trimmedName, whoCreatedIt: '@you' })
  });
  await throwIfNotOk(response);
  const body = await response.json();
  runtime.writeOut(`Created ${body.chatRoom.id} ${body.chatRoom.name}`);
  return 0;
}

async function listMembers(roomId, runtime) {
  if (!roomId) throw new CliInputError('rooms members needs a roomId');
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}`);
  await throwIfNotOk(response);
  const body = await response.json();
  for (const member of body.chatRoom.members ?? []) {
    runtime.writeOut(`${member.handle}\t${member.kind}\t(joined ${member.joinedAt})`);
  }
  return 0;
}

async function inviteAgent(roomId, agentHandle, runtime) {
  if (!roomId || !agentHandle) {
    throw new CliInputError('rooms invite needs a roomId and an agent handle');
  }
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentHandle })
  });
  await throwIfNotOk(response);
  runtime.writeOut(`Invited ${agentHandle} to ${roomId}`);
  return 0;
}

async function postMessage(roomId, body, runtime) {
  if (!roomId) throw new CliInputError('rooms post needs a roomId');
  if (!body || body.trim().length === 0) throw new CliInputError('rooms post needs a non-empty message');
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body, pidChain: processIdentityChain() })
  });
  await throwIfNotOk(response);
  const stored = (await response.json()).message;
  runtime.writeOut(`Posted ${stored.id}${stored.authorHandle ? ' as ' + stored.authorHandle : ''}`);
  return 0;
}

async function postBreak(roomId, reason, runtime) {
  if (!roomId) throw new CliInputError('rooms break needs a roomId');
  const trimmedReason = (reason ?? '').trim();
  const requestBody = trimmedReason.length > 0
    ? JSON.stringify({ reason: trimmedReason, postedByHandle: '@cli' })
    : '';
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}/breaks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody
  });
  await throwIfNotOk(response);
  const payload = await response.json();
  runtime.writeOut(`Break posted in ${roomId}: ${payload.message.body}`);
  return 0;
}

async function listMessages(roomId, runtime) {
  if (!roomId) throw new CliInputError('rooms messages needs a roomId');
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}/messages`);
  await throwIfNotOk(response);
  const body = await response.json();
  for (const message of body.messages ?? []) {
    const tag = message.kind === 'system-break' ? '━━' : message.authorDisplayName;
    runtime.writeOut(`[${message.postedAt}] ${tag}: ${message.body}`);
  }
  return 0;
}

async function fetchFromServer(runtime, path, init) {
  try {
    return await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  } catch (networkFailure) {
    throw new CliNetworkError(
      `Cannot reach server at ${runtime.serverUrl}. Is it running? (${(networkFailure instanceof Error ? networkFailure.message : 'unknown network error')})`
    );
  }
}

async function throwIfNotOk(response) {
  if (response.ok) return;
  const errorBodyMessage = await readErrorBodyMessage(response);
  const composed = errorBodyMessage
    ? `${response.status} ${response.statusText}: ${errorBodyMessage}`
    : `${response.status} ${response.statusText}`;
  throw new CliNetworkError(`Request failed: ${composed}`);
}

const MAXIMUM_ERROR_TEXT_LENGTH = 200;

async function readErrorBodyMessage(response) {
  const cloneForRead = response.clone ? response.clone() : response;
  try {
    const body = await cloneForRead.json();
    if (body && typeof body.message === 'string') return body.message;
  } catch {
    /* not JSON or unreadable — try text */
  }
  try {
    const text = await response.text();
    if (!text || text.length === 0) return null;
    return text.length > MAXIMUM_ERROR_TEXT_LENGTH
      ? `${text.slice(0, MAXIMUM_ERROR_TEXT_LENGTH)}… (truncated)`
      : text;
  } catch {
    return null;
  }
}

function formatCallFailure(causeOfFailure) {
  if (causeOfFailure instanceof CliNetworkError) return causeOfFailure.message;
  if (causeOfFailure instanceof Error) return causeOfFailure.message;
  return 'Unknown error.';
}

function printUsage({ writeOut, serverUrl }) {
  writeOut(`ant — fresh-ant CLI (server: ${serverUrl} — override with ANT_SERVER_URL)

Verbs:
  rooms list|create|members|invite|post|break|messages   Manage rooms + post + breaks.
  room members|add-member|aliases     Manage room admission and aliases.
  reaction list|add|remove            Manage message reactions.
  status show --room ROOM_ID          Show pane/terminal delivery status per room member.
  delivery verify --terminal ID       Show delivery state (verified/stale/unknown) + reason.
  audit permissions --room ROOM_ID    Audit identity proofs for every room member.
  docs generate --from-cli            Generate manifest-derived markdown.
  linkedchat list|allow|deny          Manage terminal-scoped linked-chat permissions.
  fingerprint detect <terminal-id>    Detect agent kind via 5-source cascade.
  mcp list|grant|revoke               Manage MCP adapter grants (admin-bearer).
  remote admit|redeem|mapping         Remote ANT bridge admission + mapping management.
  remote-room send|status|ack|quarantine  Remote-bridge message ops (admin-bearer).`);
}
export { CliInputError, CliNetworkError };

function isEntrypoint() {
  if (import.meta.main === true) return true;
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    const thisFile = resolve(fileURLToPath(import.meta.url));
    const argvFile = resolve(process.argv[1]);
    if (process.platform === 'win32') return thisFile.toLowerCase() === argvFile.toLowerCase();
    return thisFile === argvFile;
  } catch {
    return import.meta.url === `file://${process.argv[1]}`;
  }
}

const isThisFileTheEntrypoint = isEntrypoint();

if (isThisFileTheEntrypoint) {
  const runner = makeCliRunner();
  runner.run(process.argv.slice(2)).then((exitCode) => process.exit(exitCode));
}
