/**
 * ant router - route room mentions into a local terminal pane.
 *
 * This is the packaged version of the Windows WezTerm router. It is
 * intentionally generic: the agent handle is never hard-coded. Operators
 * must pass --handle or set ANT_HANDLE so each installed machine routes
 * only its own mentions.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchRoomJsonWithBrowserSessionFallback } from './ant-cli-browser-session.mjs';

const BOOLEAN_FLAGS = new Set(['once']);
const POLL_MS_DEFAULT = 2000;
const POLL_MS_MIN = 500;
const POLL_MS_MAX = 30000;
const SEEN_CAP = 5000;

export async function handleRouterVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'start':
      return runStart(parseFlags(args, CliInputError), runtime, ctx);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown router verb: ${action}`);
  }
}

export function shouldRouteMessage(message, ownHandle) {
  if (!message || typeof message !== 'object') return false;
  const body = message.body ?? message.text ?? '';
  const authorHandle = normalizeHandle(message.authorHandle ?? message.handle ?? '');
  const targetHandle = normalizeHandle(ownHandle);
  if (!body || !authorHandle || !targetHandle) return false;
  if (authorHandle === targetHandle) return false;

  const bodyLc = body.toLowerCase();
  return bodyLc.includes(targetHandle) || /@everyone\b/i.test(body);
}

export function formatInjectedPayload(roomId, message) {
  const author = message.authorHandle ?? message.handle ?? '@unknown';
  const body = message.body ?? message.text ?? '';
  return `[antchat ${roomId} from ${author}] ${body}`;
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      flags[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    flags[flagName] = flagValue;
    cursor += 2;
  }
  return flags;
}

async function runStart(flags, runtime, ctx) {
  const { CliInputError } = ctx;
  const roomId = requireFlag(flags, 'room', CliInputError);
  const ownHandle = resolveHandle(flags, CliInputError);
  const paneId = flags['pane-id'] ?? process.env.WEZTERM_PANE ?? '0';
  const terminal = flags.terminal ?? process.env.ANT_ROUTER_TERMINAL ?? 'wezterm';
  if (terminal !== 'wezterm') {
    throw new CliInputError('only --terminal wezterm is supported today');
  }
  const pollMs = clampPollMs(flags['poll-ms'] ?? POLL_MS_DEFAULT);
  const runOnce = flags.once !== undefined;
  const seenIds = new Set();
  const spawnImpl = ctx.spawnImpl ?? spawn;
  const sleepImpl = ctx.sleepImpl ?? sleep;
  const sendTextImpl = ctx.sendTextImpl ?? ((text) => sendWezTermText(text, paneId, spawnImpl));

  log(runtime, `router starting: room=${roomId} handle=${ownHandle} pane=${paneId}`);

  let firstMessages;
  try {
    firstMessages = await fetchMessages(roomId, runtime, ownHandle);
  } catch (failure) {
    runtime.writeErr(`Router failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 1;
  }
  let lastSeenOrder = pickInitialSinceOrder(flags, firstMessages);
  if (flags['since-order'] !== undefined) {
    await routeFreshMessages(roomId, firstMessages, lastSeenOrder, ownHandle, seenIds, runtime, sendTextImpl, sleepImpl);
    lastSeenOrder = advanceLastSeen(firstMessages, lastSeenOrder);
  }
  if (runOnce) return 0;

  while (true) {
    await sleepImpl(pollMs);
    let pollMessages;
    try {
      pollMessages = await fetchMessages(roomId, runtime, ownHandle);
    } catch (failure) {
      runtime.writeErr(`Router failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
    await routeFreshMessages(roomId, pollMessages, lastSeenOrder, ownHandle, seenIds, runtime, sendTextImpl, sleepImpl);
    lastSeenOrder = advanceLastSeen(pollMessages, lastSeenOrder);
  }
}

async function routeFreshMessages(roomId, messages, sinceOrder, ownHandle, seenIds, runtime, sendTextImpl, sleepImpl) {
  const fresh = messages
    .filter((m) => Number(m.postOrder) > sinceOrder)
    .sort((a, b) => Number(a.postOrder) - Number(b.postOrder));
  for (const message of fresh) {
    const id = String(message.id ?? message.messageId ?? message.postOrder ?? '');
    if (id && seenIds.has(id)) continue;
    if (!shouldRouteMessage(message, ownHandle)) continue;
    if (id) rememberSeenId(seenIds, id);
    await injectMessage(roomId, message, runtime, sendTextImpl, sleepImpl);
  }
}

async function injectMessage(roomId, message, runtime, sendTextImpl, sleepImpl) {
  const payload = formatInjectedPayload(roomId, message);
  log(runtime, `inject: ${payload.slice(0, 120)}`);
  await sendTextImpl(payload);
  await sleepImpl(150);
  await sendTextImpl('\r');
}

function sendWezTermText(text, paneId, spawnImpl) {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl('wezterm', ['cli', 'send-text', '--pane-id', String(paneId), '--no-paste'], {
      stdio: ['pipe', 'inherit', 'inherit']
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wezterm cli send-text exit ${code}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

function resolveHandle(flags, CliInputError) {
  const raw = flags.handle ?? process.env.ANT_HANDLE;
  if (!raw || raw.trim().length === 0) {
    throw new CliInputError('missing required --handle @agent (or set ANT_HANDLE)');
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function fetchMessages(roomId, runtime, explicitHandle) {
  const path = `/api/chat-rooms/${encodeURIComponent(roomId)}/messages`;
  const parsed = await fetchRoomJsonWithBrowserSessionFallback(runtime, roomId, path, explicitHandle);
  return parsed.messages ?? [];
}

function pickInitialSinceOrder(flags, messages) {
  if (flags['since-order'] !== undefined) {
    const parsed = Number(flags['since-order']);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (messages.length === 0) return 0;
  return advanceLastSeen(messages, 0);
}

function advanceLastSeen(messages, sinceOrder) {
  let highest = sinceOrder;
  for (const message of messages) {
    const postOrder = Number(message.postOrder);
    if (Number.isFinite(postOrder) && postOrder > highest) highest = postOrder;
  }
  return highest;
}

function rememberSeenId(seenIds, id) {
  seenIds.add(id);
  if (seenIds.size <= SEEN_CAP) return;
  const ids = Array.from(seenIds);
  seenIds.clear();
  for (const item of ids.slice(Math.floor(ids.length / 2))) seenIds.add(item);
}

function clampPollMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return POLL_MS_DEFAULT;
  if (parsed < POLL_MS_MIN) return POLL_MS_MIN;
  if (parsed > POLL_MS_MAX) return POLL_MS_MAX;
  return parsed;
}

function normalizeHandle(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return '';
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function log(runtime, message) {
  const ts = new Date().toISOString().slice(11, 19);
  runtime.writeErr(`[${ts} router] ${message}`);
}

function writeUsage(runtime) {
  runtime.writeOut('ant router <start> [flags]');
  runtime.writeOut('  start --room ROOM_ID --handle @agent [--pane-id N] [--poll-ms 2000]');
  runtime.writeOut('  Routes @handle and @everyone room messages into a local WezTerm pane.');
}
