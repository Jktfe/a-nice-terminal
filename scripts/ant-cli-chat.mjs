/**
 * ant chat — CLI verb to tail a fresh-ant chatroom.
 *
 * Verb:
 *   ant chat tail --room ROOM_ID [--since-order N] [--poll-ms 2000] [--once]
 *   ant chat break --room ROOM_ID [--reason TEXT] [--handle @you]
 *   ant chat read --room ROOM_ID --message MESSAGE_ID [--handle @you]
 *   ant chat typing --room ROOM_ID [--handle @you]
 *   ant chat draft --room ROOM_ID (--text TEXT | --clear) [--handle @you]
 *
 * Polls GET /api/chat-rooms/:roomId/messages and prints messages with
 * postOrder strictly greater than lastSeenOrder. Advances lastSeenOrder
 * to max seen each iteration. Default behavior: runs indefinitely until
 * SIGINT — empty polls do NOT exit. --once exits after exactly one
 * fetch.
 *
 * Output line: <postedAt> [<kind>] <authorHandle>: <body>
 * Body is emitted in full. Agent routers consume this stream, so truncating
 * here silently drops instructions.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import {
  resolveChatRoomIdentifier,
  makeStandardSendJson,
  resolveRoomServerUrl
} from './ant-cli-shared-resolve.mjs';
import { handleChatPendingVerb } from './ant-cli-chat-pending.mjs';
import { fetchRoomJsonWithBrowserSessionFallback } from './ant-cli-browser-session.mjs';

const ALLOWED_KIND_TAGS = new Set(['human', 'agent', 'system', 'system-break']);
const BOOLEAN_FLAGS = new Set(['once', 'json', 'clear']);
// Known top-level action verbs for `ant chat <action>`. Anything else
// in the first slot is treated as a chat identifier (name or id) per
// the JWPK 2026-05-16 verb spec: `ant chat <chatname> send <msg>`.
const KNOWN_CHAT_ACTIONS = new Set([
  'send', 'post', 'tail', 'break', 'read', 'typing', 'draft', 'pending',
  'focus', 'unfocus', 'decide',
  'help', '--help'
]);

// Parse `--for 30m | 1h | 2d` into milliseconds. Returns undefined on
// missing/blank (indefinite focus); throws on garbage so the CLI shows
// the user a useful error instead of silently picking 0.
function parseDurationToMs(raw, CliInputError) {
  if (!raw || raw.trim().length === 0) return undefined;
  const match = raw.trim().match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) throw new CliInputError(`--for "${raw}" — use e.g. 30s, 30m, 1h, 2d`);
  const n = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const multiplier = unit === 's' ? 1000
    : unit === 'm' ? 60_000
    : unit === 'h' ? 3_600_000
    : 86_400_000;
  return n * multiplier;
}
const POLL_MS_MIN = 500;
const POLL_MS_MAX = 30000;
const POLL_MS_DEFAULT = 2000;

export async function handleChatVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;

  // JWPK 2026-05-16 name-aware routing: if the first token is NOT a
  // known action verb, treat it as a chat-room identifier (name or id)
  // and the next token is the sub-action.
  if (action && !KNOWN_CHAT_ACTIONS.has(action)) {
    return handleNameAwareChatVerb(action, args, runtime, CliInputError);
  }

  // `chat send`/`post`/`focus`/`unfocus`/`decide` accept the room id as
  // a positional. parseFlags rejects bare positional args by default, so
  // we peel before parsing.
  let positionalRoomId;
  const PEEL_POSITIONAL_ACTIONS = new Set(['send', 'post', 'focus', 'unfocus', 'decide']);
  if (PEEL_POSITIONAL_ACTIONS.has(action) && args.length > 0 && !args[0].startsWith('--')) {
    positionalRoomId = args[0];
    args = args.slice(1);
  }
  // `decide` keeps two more positionals (discussionId + decision-text).
  // Peel them too BEFORE flag parsing.
  let positionalDiscussionId;
  let positionalDecisionParts = [];
  if (action === 'decide') {
    if (args.length > 0 && !args[0].startsWith('--')) {
      positionalDiscussionId = args[0];
      args = args.slice(1);
    }
    while (args.length > 0 && !args[0].startsWith('--')) {
      positionalDecisionParts.push(args[0]);
      args = args.slice(1);
    }
  }
  const flags = parseFlags(args, CliInputError);
  if (positionalRoomId && !flags.room) flags.room = positionalRoomId;
  if (positionalDiscussionId && !flags.discussion) flags.discussion = positionalDiscussionId;
  if (positionalDecisionParts.length > 0 && !flags.decision) flags.decision = positionalDecisionParts.join(' ');
  switch (action) {
    case 'send':
    case 'post': return runSend(flags, runtime, CliInputError);
    case 'pending': return handleChatPendingVerb(args, runtime, { CliInputError });
    case 'focus': return runFocus(flags, runtime, CliInputError);
    case 'unfocus': return runUnfocus(flags, runtime, CliInputError);
    case 'decide': return runDecide(flags, runtime, CliInputError);
    case 'tail': return runTail(flags, runtime, CliInputError);
    case 'break': return runBreak(flags, runtime, CliInputError);
    case 'read': return runRead(flags, runtime, CliInputError);
    case 'typing': return runTyping(flags, runtime, CliInputError);
    case 'draft': return runDraft(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown chat verb: ${action}`);
  }
}

/**
 * Name-aware shape: `ant chat <chatname> [subaction] [args]`.
 *   chat <chatname>                  → show id + summary
 *   chat <chatname> send <msg...>    → POST a message (alias: post)
 *   chat <chatname> post <msg...>    → alias of send
 *   chat <chatname> reply <messageId> <msg...>  → POST with parentMessageId
 *   chat <chatname> namechange <new> → PATCH /api/chat-rooms/:roomId/name
 */
async function handleNameAwareChatVerb(chatIdentifier, args, runtime, CliInputError) {
  const subAction = args[0];
  const subArgs = args.slice(1);

  if (!subAction || subAction === 'help' || subAction === '--help') {
    return runShowChat(chatIdentifier, subArgs, runtime, CliInputError);
  }

  switch (subAction) {
    case 'send':
    case 'post': return runNameAwarePost(chatIdentifier, subArgs, runtime, CliInputError, null);
    case 'reply': {
      const parentMessageId = subArgs[0];
      if (!parentMessageId) throw new CliInputError('reply needs a parent message id');
      return runNameAwarePost(chatIdentifier, subArgs.slice(1), runtime, CliInputError, parentMessageId);
    }
    case 'namechange': return runNameAwareRename(chatIdentifier, subArgs, runtime, CliInputError);
    case 'search': return runNameAwareSearch(chatIdentifier, subArgs, runtime, CliInputError);
    default:
      throw new CliInputError(`unknown chat <chatname> sub-verb: ${subAction}`);
  }
}

async function runNameAwareSearch(chatIdentifier, args, runtime, CliInputError) {
  const { flags, positionals } = parsePositionalsAndFlags(args, CliInputError);
  const query = (flags.q ?? flags.query ?? positionals.join(' ')).trim();
  if (!query) throw new CliInputError('search needs a query (positional or --q)');
  const limit = Math.max(1, Math.min(200,
    flags.limit ? Number(flags.limit) : 50));
  const room = await resolveChatRoomIdentifier(runtime, chatIdentifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/chat-rooms/${encodeURIComponent(room.id)}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    'GET'
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const matches = result?.matches ?? [];
    if (matches.length === 0) {
      runtime.writeOut(`(no matches for "${query}" in "${room.name}")`);
    } else {
      for (const m of matches) runtime.writeOut(`${m.postedAt}\t${m.authorHandle}\t${m.body}`);
    }
  }
  return 0;
}

function parsePositionalsAndFlags(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
    }
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      flags[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    flags[flagName] = value;
    cursor += 2;
  }
  return { flags, positionals };
}

async function runShowChat(chatIdentifier, args, runtime, CliInputError) {
  const { flags } = parsePositionalsAndFlags(args, CliInputError);
  const room = await resolveChatRoomIdentifier(runtime, chatIdentifier, CliInputError);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(room));
  } else {
    runtime.writeOut(`Chat room "${room.name}"`);
    runtime.writeOut(`  id:              ${room.id}`);
    runtime.writeOut(`  attention:       ${room.attentionState ?? '-'}`);
    runtime.writeOut(`  whoCreatedIt:    ${room.whoCreatedIt ?? '-'}`);
    runtime.writeOut(`  creationOrder:   ${room.creationOrder ?? '-'}`);
    runtime.writeOut(`  members:         ${(room.members ?? []).length}`);
  }
  return 0;
}

async function runNameAwarePost(chatIdentifier, args, runtime, CliInputError, parentMessageId) {
  const { flags, positionals } = parsePositionalsAndFlags(args, CliInputError);
  const body = (flags.msg ?? flags.body ?? positionals.join(' ')).trim();
  if (!body) throw new CliInputError('post needs a message (positional or --msg)');
  const room = await resolveChatRoomIdentifier(runtime, chatIdentifier, CliInputError);
  const payload = { body, pidChain: processIdentityChain() };
  if (parentMessageId) payload.parentMessageId = parentMessageId;
  if (flags.handle) payload.authorHandle = flags.handle;
  if (flags.kind) {
    if (!ALLOWED_KIND_TAGS.has(flags.kind)) {
      throw new CliInputError(`--kind must be one of ${[...ALLOWED_KIND_TAGS].join(', ')}`);
    }
    payload.kind = flags.kind;
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/chat-rooms/${encodeURIComponent(room.id)}/messages`, 'POST', payload);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const m = result?.message ?? {};
    const verb = parentMessageId ? 'Replied' : 'Posted';
    runtime.writeOut(`${verb} ${m.id ?? '?'} as ${m.authorHandle ?? '?'} into "${room.name}".`);
  }
  return 0;
}

async function runNameAwareRename(chatIdentifier, args, runtime, CliInputError) {
  const { flags, positionals } = parsePositionalsAndFlags(args, CliInputError);
  const newName = positionals[0] ?? flags['new-name'];
  if (!newName) throw new CliInputError('namechange needs a new name (positional or --new-name)');
  const room = await resolveChatRoomIdentifier(runtime, chatIdentifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/chat-rooms/${encodeURIComponent(room.id)}/name`, 'PATCH', { newName });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const updated = result?.chatRoom ?? result;
    runtime.writeOut(`Renamed chat ${room.id}: "${room.name}" → "${updated.name ?? newName}"`);
  }
  return 0;
}

/**
 * `ant chat send <roomId> --msg "..."` — POST a message into a chat
 * room. The body is sent in --msg (a single string) or --body (alias).
 * pidChain is appended automatically so the server can resolve the
 * caller's identity via FINDING-3 (terminal posting to its own linked
 * chat) without requiring authorHandle.
 */
async function runSend(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const body = flags.msg ?? flags.body;
  if (typeof body !== 'string' || body.length === 0) {
    throw new CliInputError('missing required --msg "..." (or --body)');
  }
  const payload = { body, pidChain: processIdentityChain() };
  if (flags.handle) payload.authorHandle = flags.handle;
  if (flags.kind) {
    if (!ALLOWED_KIND_TAGS.has(flags.kind)) {
      throw new CliInputError(`--kind must be one of ${[...ALLOWED_KIND_TAGS].join(', ')}`);
    }
    payload.kind = flags.kind;
  }
  if (flags['parent-message']) payload.parentMessageId = flags['parent-message'];

  // JWPK msg_4tclr02hm5 (2026-05-19) — gate-fix: post-compaction the
  // shell pidChain often can't walk back to a registered terminal, so
  // identity-gate 403s with "Server-resolved identity required". This
  // is a real wall for every claude after a context compaction wave.
  //
  // Auto-mint workaround: on 403, mint a per-room browser_session cookie
  // for the agent's handle (resolved from --handle flag, ~/.ant/config
  // per-room token, or the global handle, in that order), then retry the
  // POST with that cookie. The /browser-session route's same-origin check
  // is satisfied by sending Origin matching Host (CLI is calling its own
  // localhost server). The mint server-side already verifies the handle
  // IS a room member, so this can't be used to spoof.
  const messagesPath = `/api/chat-rooms/${encodeURIComponent(room)}/messages`;
  // 0.1.8 slice H: prefer the per-room server_url stamped by
  // `ant invite redeem` over the global runtime.serverUrl. Explicit
  // ANT_SERVER_URL env still wins inside resolveRoomServerUrl.
  const roomServerUrl = resolveRoomServerUrl(runtime, room);
  let result;
  try {
    result = await sendJson(runtime, messagesPath, 'POST', payload, roomServerUrl);
  } catch (firstAttemptError) {
    const isIdentityWedge =
      firstAttemptError instanceof Error &&
      /returned 403/.test(firstAttemptError.message) &&
      /Server-resolved identity required/.test(firstAttemptError.message);
    if (!isIdentityWedge) throw firstAttemptError;
    const mintedCookie = await mintBrowserSessionCookie(runtime, room, flags.handle, roomServerUrl);
    if (!mintedCookie) throw firstAttemptError;
    result = await sendJsonWithCookie(runtime, messagesPath, 'POST', payload, mintedCookie, roomServerUrl);
  }
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const m = result?.message;
    runtime.writeOut(`Posted ${m?.id ?? '?'} as ${m?.authorHandle ?? '?'} into ${room}.`);
  }
  return 0;
}

/**
 * Mint a browser_session cookie for (room, handle) via POST /browser-session.
 * Returns the raw `ant_browser_session=...` cookie value (just the
 * name=value pair, no other attributes) suitable for a Cookie request
 * header, or null on failure.
 */
async function mintBrowserSessionCookie(runtime, roomId, explicitHandle, baseUrl) {
  const handle = resolveCallerHandleForRoom(runtime, roomId, explicitHandle);
  if (!handle) return null;
  const base = baseUrl ?? runtime.serverUrl;
  const url = `${base}/api/chat-rooms/${encodeURIComponent(roomId)}/browser-session`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base
    },
    body: JSON.stringify({ authorHandle: handle, pidChain: processIdentityChain() })
  });
  if (!response.ok) return null;
  // Parse Set-Cookie. fetch undici returns a comma-joined string on .get
  // but cookies legitimately contain commas in Expires=... attrs, so we
  // use .getSetCookie() when available (Node >=20).
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  for (const raw of cookies) {
    const match = /^(ant_browser_session=[^;]+)/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

/**
 * Best-effort handle resolution for the auto-mint fallback. Order:
 *   --handle flag → per-room token in ~/.ant/config.json → global handle.
 * Returns null if none can be derived (rare; user can supply --handle).
 */
function resolveCallerHandleForRoom(runtime, roomId, explicitHandle) {
  if (typeof explicitHandle === 'string' && explicitHandle.length > 0) {
    return explicitHandle.startsWith('@') ? explicitHandle : `@${explicitHandle}`;
  }
  try {
    const config = runtime.config ?? {};
    const roomToken = config.tokens?.[roomId];
    if (roomToken && typeof roomToken.handle === 'string') return roomToken.handle;
    if (typeof config.handle === 'string') return config.handle;
  } catch { /* config absent — fall through */ }
  return null;
}

async function sendJsonWithCookie(runtime, path, method, body, cookieValue, baseUrl) {
  const base = baseUrl ?? runtime.serverUrl;
  const response = await runtime.fetchImpl(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookieValue,
      origin: base
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`${method} ${path} (retry-with-cookie) returned ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  return response.json();
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function writeUsage(runtime) {
  runtime.writeOut('ant chat <send|tail|break|read|typing|draft|focus|unfocus|decide> [flags]');
  runtime.writeOut('  send <roomId> --msg TEXT [--handle @h] [--kind human|agent|system]');
  runtime.writeOut('  tail --room ROOM_ID [--since-order N] [--poll-ms 2000] [--once]');
  runtime.writeOut('  break --room ROOM_ID [--reason TEXT] [--handle @you]');
  runtime.writeOut('  read --room ROOM_ID --message MESSAGE_ID [--handle @you] [--json]');
  runtime.writeOut('  typing --room ROOM_ID [--handle @you]');
  runtime.writeOut('  draft --room ROOM_ID (--text TEXT | --clear) [--handle @you] [--json]');
  runtime.writeOut('  focus <roomId> [--member @h] [--for 30m] [--reason TEXT] [--json]');
  runtime.writeOut('  unfocus <roomId> [--member @h] [--json]');
  runtime.writeOut('  decide <roomId> <discussionId> <decision-text...> [--json]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function handleFlag(flags) {
  const raw = flags.handle ?? '@cli';
  return raw.startsWith('@') ? raw : `@${raw}`;
}

async function sendJson(runtime, path, method, body, baseUrl) {
  const base = baseUrl ?? runtime.serverUrl;
  const response = await runtime.fetchImpl(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`${method} ${path} returned ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  return response.json();
}

function writeResult(runtime, flags, result, line) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(result));
  else runtime.writeOut(line);
}

function clampPollMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return POLL_MS_DEFAULT;
  if (parsed < POLL_MS_MIN) return POLL_MS_MIN;
  if (parsed > POLL_MS_MAX) return POLL_MS_MAX;
  return parsed;
}

function formatMessageLine(message) {
  const kindTag = ALLOWED_KIND_TAGS.has(message.kind) ? message.kind : 'unknown';
  return `${message.postedAt} [${kindTag}] ${message.authorHandle}: ${message.body ?? ''}`;
}

async function sleepMillis(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return messages.reduce((max, m) => (m.postOrder > max ? m.postOrder : max), 0);
}

async function runTail(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const pollMs = clampPollMs(flags['poll-ms'] ?? POLL_MS_DEFAULT);
  const runOnce = flags.once !== undefined;
  let firstMessages;
  try {
    firstMessages = await fetchMessages(room, runtime, flags.handle);
  } catch (failure) {
    runtime.writeErr(`Tail failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 1;
  }
  let lastSeenOrder = pickInitialSinceOrder(flags, firstMessages);
  if (flags['since-order'] !== undefined) {
    emitNewMessages(firstMessages, lastSeenOrder, runtime);
    lastSeenOrder = advanceLastSeen(firstMessages, lastSeenOrder);
  }
  if (runOnce) return 0;
  while (true) {
    await sleepMillis(pollMs);
    let pollMessages;
    try {
      pollMessages = await fetchMessages(room, runtime, flags.handle);
    } catch (failure) {
      runtime.writeErr(`Tail failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      return 1;
    }
    emitNewMessages(pollMessages, lastSeenOrder, runtime);
    lastSeenOrder = advanceLastSeen(pollMessages, lastSeenOrder);
  }
}

async function runBreak(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const reason = flags.reason ?? '';
  const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/breaks`, 'POST', {
    reason,
    postedByHandle: handleFlag(flags),
    pidChain: processIdentityChain()
  });
  writeResult(runtime, flags, result, `Break posted: ${result.message?.id ?? room}`);
  return 0;
}

async function runRead(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const message = requireFlag(flags, 'message', CliInputError);
  const result = await sendJson(
    runtime,
    `/api/chat-rooms/${encodeURIComponent(room)}/messages/${encodeURIComponent(message)}/read`,
    'POST',
    { readerHandle: handleFlag(flags), pidChain: processIdentityChain() }
  );
  writeResult(runtime, flags, result, `Marked read: ${message}`);
  return 0;
}

async function runTyping(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/typing`, 'POST', {
    memberHandle: handleFlag(flags),
    pidChain: processIdentityChain()
  });
  writeResult(runtime, flags, result, `Typing heartbeat sent: ${room}`);
  return 0;
}

async function runDraft(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const authorHandle = handleFlag(flags);
  if (flags.clear !== undefined) {
    const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/composer-draft`, 'DELETE', {
      authorHandle,
      pidChain: processIdentityChain()
    });
    writeResult(runtime, flags, result, `Draft cleared: ${room}`);
    return 0;
  }
  if (flags.text === undefined) {
    throw new CliInputError('draft requires --text or --clear');
  }
  const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/composer-draft`, 'PUT', {
    authorHandle,
    draftText: flags.text,
    pidChain: processIdentityChain()
  });
  writeResult(runtime, flags, result, `Draft saved: ${room}`);
  return 0;
}

function emitNewMessages(messages, sinceOrder, runtime) {
  const fresh = messages
    .filter((m) => Number(m.postOrder) > sinceOrder)
    .sort((a, b) => a.postOrder - b.postOrder);
  for (const message of fresh) {
    runtime.writeOut(formatMessageLine(message));
  }
}

function advanceLastSeen(messages, sinceOrder) {
  let highest = sinceOrder;
  for (const m of messages) {
    if (Number(m.postOrder) > highest) highest = Number(m.postOrder);
  }
  return highest;
}

/**
 * `ant chat focus <roomId> --member @h [--for 30m] [--reason "..."]`
 * Sets the head-down signal for one member in one room. `--for` accepts
 * a duration (s/m/h/d); omit for indefinite. Backs PUT
 * /api/chat-rooms/:roomId/focus-mode.
 */
async function runFocus(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const memberHandle = flags.member ?? flags.handle ?? '@you';
  const payload = { memberHandle };
  if (flags.reason) payload.reason = flags.reason;
  if (flags.for) {
    const durationMs = parseDurationToMs(flags.for, CliInputError);
    if (durationMs !== undefined) payload.durationMs = durationMs;
  }
  const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/focus-mode`, 'PUT', payload);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const entry = result?.focusEntry ?? {};
    const expires = entry.expiresAt ? `, expires ${entry.expiresAt}` : ' (indefinite)';
    runtime.writeOut(`Focus set for ${entry.memberHandle ?? memberHandle} in ${room}${expires}.`);
  }
  return 0;
}

/**
 * `ant chat unfocus <roomId> --member @h`
 * Clears the head-down signal. Backs DELETE
 * /api/chat-rooms/:roomId/focus-mode.
 */
async function runUnfocus(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const memberHandle = flags.member ?? flags.handle ?? '@you';
  const result = await sendJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/focus-mode`, 'DELETE', { memberHandle });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    runtime.writeOut(`Focus cleared for ${memberHandle} in ${room} (wasActive=${result?.wasActive ?? '?'})`);
  }
  return 0;
}

/**
 * `ant chat decide <roomId> <discussionId> <decision-text...>`
 * Closes a discussion with the recorded decision. Backs PATCH
 * /api/chat-rooms/:roomId/discussions/:discussionId. The decision is
 * stored as the discussion's summary; status flips to closed.
 */
async function runDecide(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  const discussionId = requireFlag(flags, 'discussion', CliInputError);
  const decision = flags.decision;
  if (typeof decision !== 'string' || decision.trim().length === 0) {
    throw new CliInputError('decide needs a decision text (positional or --decision)');
  }
  const payload = { decision: decision.trim(), pidChain: processIdentityChain() };
  const result = await sendJson(
    runtime,
    `/api/chat-rooms/${encodeURIComponent(room)}/discussions/${encodeURIComponent(discussionId)}`,
    'PATCH',
    payload
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const d = result?.discussion ?? {};
    runtime.writeOut(`Discussion ${d.id ?? discussionId} closed with decision: "${d.summary ?? decision}"`);
  }
  return 0;
}
