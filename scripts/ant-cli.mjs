#!/usr/bin/env node
/**
 * ant — small CLI driving the ANT vNext server from a terminal via fetch.
 * Default target http://127.0.0.1:6174 (override with ANT_SERVER_URL).
 * Sub-verbs dispatched to ./ant-cli-<verb>.mjs handlers. Tests mock fetch
 * and capture stdout/stderr. 9-year-old-readable; verb logic lives in the
 * per-verb modules, this file stays a thin router.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { resolveCliVersion } from './ant-cli-version-helper.mjs';
import { handleAgentsVerb } from './ant-cli-agents.mjs';
import { handleArtefactVerb } from './ant-cli-artefact.mjs';
import { handleAskVerb } from './ant-cli-ask.mjs';
import { handleAttachVerb } from './ant-cli-attach.mjs';
import { handleAuditVerb } from './ant-cli-audit.mjs';
import { handleBindVerb } from './ant-cli-bind.mjs';
// Namespace import: robust against a stale generated constants file that
// predates the cutover flag (missing property reads as undefined, no link error).
import * as cliBuildConstants from './ant-cli-version-constant.mjs';
import { tombstoneIfCutover } from './ant-cli-tombstones.mjs';
const ANT_CLI_CUTOVER_CONSTANT = cliBuildConstants.ANT_CLI_CUTOVER_CONSTANT === true;
import { handleChairVerb } from './ant-cli-chair.mjs';
import { handleChatVerb, withDurableSessionIdentity, durableSessionHeaders } from './ant-cli-chat.mjs';
import { handleConnectVerb } from './ant-cli-connect.mjs';
import { handleDeckVerb } from './ant-cli-deck.mjs';
import { handleDecksVerb } from './ant-cli-decks.mjs';
import { handleDeliveryVerb } from './ant-cli-delivery.mjs';
import { handleDiscussionVerb } from './ant-cli-discussion.mjs';
import { handleDocsVerb } from './ant-cli-docs.mjs';
import { handleFingerprintVerb } from './ant-cli-fingerprint.mjs';
import { handleFlagVerb } from './ant-cli-flag.mjs';
import { handleGrantVerb } from './ant-cli-grant-verb.mjs';
import { handleHandleVerb } from './ant-cli-handle.mjs';
import { handleHooksVerb } from './ant-cli-hooks.mjs';
import { handleIdentityVerb } from './ant-cli-identity.mjs';
import { handleInterviewVerb } from './ant-cli-interview.mjs';
import { handleInviteVerb } from './ant-cli-invites.mjs';
import { handleLinkedchatVerb } from './ant-cli-linkedchat.mjs';
import { handleListVerb } from './ant-cli-list.mjs';
import { handleMcpVerb } from './ant-cli-mcp.mjs';
import { handleMemoryVerb } from './ant-cli-memory.mjs';
import { handleBriefVerb } from './ant-cli-brief.mjs';
import { handleNewVerb } from './ant-cli-new.mjs';
import { handlePairingVerb } from './ant-cli-pairing.mjs';
import { handlePlanVerb } from './ant-cli-plan.mjs';
import { handleQueueVerb } from './ant-cli-queue.mjs';
import { handleReactionVerb } from './ant-cli-reaction.mjs';
import { handleReclaimVerb } from './ant-cli-reclaim.mjs';
import { handleRegisterVerb, handleAddVerb, handleResolveVerb } from './ant-cli-register.mjs';
import { handleRemoteVerb, handleRemoteRoomVerb } from './ant-cli-remote.mjs';
import { handleRequestVerb } from './ant-cli-request.mjs';
import { handleRouterVerb } from './ant-cli-router.mjs';
import { handleRoomVerb } from './ant-cli-room.mjs';
import { handleScreenshotVerb } from './ant-cli-screenshot.mjs';
import { handleSessionsVerb } from './ant-cli-sessions.mjs';
import { handleSettingsVerb } from './ant-cli-settings.mjs';
import { handleShareVerb } from './ant-cli-share.mjs';
import { handleStageVerb } from './ant-cli-stage.mjs';
import { handleStatusVerb } from './ant-cli-status.mjs';
import { handleTaskVerb } from './ant-cli-task.mjs';
import { handleTerminalVerb } from './ant-cli-terminal.mjs';
import { handleToolsVerb } from './ant-cli-tools.mjs';
import { handleTunnelVerb } from './ant-cli-tunnel.mjs';
import { handleVoiceVerb } from './ant-cli-voice.mjs';
import { handleVoteVerb } from './ant-cli-vote.mjs';
import { handleWhoamiVerb } from './ant-cli-whoami.mjs';
import { handleHelperVerb } from './ant-cli-helper.mjs';
import { fetchRoomJsonWithBrowserSessionFallback } from './ant-cli-browser-session.mjs';
import { renderPermissionDeniedIfPresent } from './ant-cli-permission-denied.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:6174';
const ENV_SERVER_URL = process.env.ANT_SERVER_URL?.trim();

const DISPATCH = {
  plan: handlePlanVerb, ask: handleAskVerb, artefact: handleArtefactVerb, attach: handleAttachVerb, bind: handleBindVerb, invite: handleInviteVerb, chat: handleChatVerb, connect: handleConnectVerb, room: handleRoomVerb,
  queue: handleQueueVerb, reaction: handleReactionVerb, reclaim: handleReclaimVerb, handle: handleHandleVerb, status: handleStatusVerb, delivery: handleDeliveryVerb, audit: handleAuditVerb, docs: handleDocsVerb,
  deck: handleDeckVerb, decks: handleDecksVerb, stage: handleStageVerb, remote: handleRemoteVerb, 'remote-room': handleRemoteRoomVerb, discussion: handleDiscussionVerb, linkedchat: handleLinkedchatVerb, fingerprint: handleFingerprintVerb, mcp: handleMcpVerb, chair: handleChairVerb, interview: handleInterviewVerb, screenshot: handleScreenshotVerb, hooks: handleHooksVerb, new: handleNewVerb, list: handleListVerb, terminal: handleTerminalVerb, tools: handleToolsVerb, settings: handleSettingsVerb, flag: handleFlagVerb, grant: handleGrantVerb, request: handleRequestVerb, task: handleTaskVerb, memory: handleMemoryVerb, brief: handleBriefVerb, sessions: handleSessionsVerb, voice: handleVoiceVerb, vote: handleVoteVerb, tunnel: handleTunnelVerb, pairing: handlePairingVerb, agents: handleAgentsVerb, share: handleShareVerb, identity: handleIdentityVerb, register: handleRegisterVerb, add: handleAddVerb, resolve: handleResolveVerb, router: handleRouterVerb, whoami: handleWhoamiVerb, helper: handleHelperVerb
};

export function makeCliRunner({ fetchImpl, writeOut, writeErr, serverUrl, serverUrlSource: suppliedServerUrlSource, config, envTmuxPane } = {}) {
  const output = writeOut ?? ((line) => console.log(line));
  const errorOutput = writeErr ?? ((line) => console.error(line));
  const configuredServerUrl = serverUrl ?? ENV_SERVER_URL ?? DEFAULT_SERVER_URL;
  const serverUrlSource = suppliedServerUrlSource ?? (serverUrl ? 'explicit' : (ENV_SERVER_URL ? 'env' : 'default'));
  const baseFetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const runtime = {
    fetchImpl: async (url, init) => fetchWithServerFallback(runtime, baseFetchImpl, url, init),
    writeOut: output,
    writeErr: errorOutput,
    serverUrl: configuredServerUrl,
    serverUrlSource,
    config: config ?? loadAntConfig(),
    envTmuxPane,
    homeDir: homedir(),
    cwd: process.cwd(),
    processPpid: process.ppid,
    fallbackWarned: false,
    isInteractive: process.stdin.isTTY === true,
    promptImpl: async (q) => {
      const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(q); } finally { rl.close(); }
    }
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
    // Identity-cutover tombstones (kill-list msg_d55jrfpr95): inert on main
    // (constant false); the cut binary is compiled with ANT_CLI_CUTOVER=1 and
    // retired verbs answer with why-they-died + the replacement, exit 9.
    {
      const twoWord = secondaryVerb ? `${primaryVerb} ${secondaryVerb}` : null;
      const tombstoned =
        (twoWord && tombstoneIfCutover(ANT_CLI_CUTOVER_CONSTANT, twoWord, runtime.writeErr)) ??
        tombstoneIfCutover(ANT_CLI_CUTOVER_CONSTANT, primaryVerb, runtime.writeErr);
      if (tombstoned !== null) return tombstoned;
    }
    try {
      if (DISPATCH[primaryVerb]) {
        const fn = DISPATCH[primaryVerb];
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

async function fetchWithServerFallback(runtime, fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch (primaryFailure) {
    const canFallback =
      runtime.serverUrlSource === 'env' &&
      runtime.serverUrl !== DEFAULT_SERVER_URL &&
      typeof url === 'string' &&
      url.startsWith(runtime.serverUrl);
    if (!canFallback) throw primaryFailure;

    const fallbackUrl = DEFAULT_SERVER_URL + url.slice(runtime.serverUrl.length);
    try {
      const response = await fetchImpl(fallbackUrl, init);
      if (!runtime.fallbackWarned) {
        runtime.writeErr(`Warning: ANT_SERVER_URL ${runtime.serverUrl} was unreachable; using ${DEFAULT_SERVER_URL} for this command.`);
        runtime.fallbackWarned = true;
      }
      runtime.serverUrl = DEFAULT_SERVER_URL;
      runtime.serverUrlSource = 'default';
      return response;
    } catch {
      throw primaryFailure;
    }
  }
}

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

/**
 * Extract a single named flag's value (`--name foo` → `'foo'`). Returns
 * `null` when the flag is absent or value-less. Added 2026-05-25 for
 * dogfood finding #2: `ant rooms create --name X` was inconsistent with
 * sibling verbs (`ant router start --room X --handle Y`). Now both
 * positional and flag form are accepted everywhere this helper is used.
 */
function flagValue(rawArgs, name) {
  for (let i = 0; i < rawArgs.length - 1; i += 1) {
    if (rawArgs[i] === `--${name}`) {
      const value = rawArgs[i + 1];
      if (value !== undefined && !value.startsWith('--')) return value;
    }
  }
  return null;
}

async function handleRoomsVerb(action, args, runtime) {
  switch (action) {
    case 'list':
      return listRooms(runtime);
    case 'create': {
      // Accept either positional (`ant rooms create "X"`) or flag
      // (`ant rooms create --name X`). Flag form keeps `ant rooms create`
      // consistent with `ant router start --room --handle` etc — closes
      // dogfood finding #2 (2026-05-25).
      const flagName = flagValue(args, 'name');
      const positionalName = stripFlags(args).join(' ');
      return createRoom(flagName ?? positionalName, runtime);
    }
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
  const sessionId = durableSessionIdForRuntime(runtime);
  let response = sessionId
    ? await fetchFromServer(runtime, '/api/chat-rooms', {
        headers: { 'x-ant-session-id': sessionId }
      })
    : await fetchFromServer(runtime, pathWithPidChain('/api/chat-rooms'));
  if (sessionId && response.status === 401) {
    response = await fetchFromServer(runtime, pathWithPidChain('/api/chat-rooms'));
  }
  await throwIfNotOk(response, runtime);
  const body = await response.json();
  for (const room of body.chatRooms ?? []) {
    runtime.writeOut(`${room.id}\t${room.name}\t(${room.members.length} members)`);
  }
  return 0;
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

async function createRoom(name, runtime) {
  const trimmedName = (name ?? '').trim();
  if (trimmedName.length === 0) {
    // Inline-usage error (dogfood finding #2, 2026-05-25). The general
    // catch in run() still falls through to printUsage, but the user now
    // sees actionable rooms-create syntax first.
    throw new CliInputError(
      'rooms create needs a name\n  Usage: ant rooms create "<NAME>"\n     or: ant rooms create --name "<NAME>"'
    );
  }
  const response = await fetchFromServer(runtime, pathWithPidChain('/api/chat-rooms'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: trimmedName })
  });
  await throwIfNotOk(response, runtime);
  const body = await response.json();
  const roomId = body.chatRoom.id;
  runtime.writeOut(`Created ${roomId} ${body.chatRoom.name}`);
  // Next-step nudge (dogfood finding #3, 2026-05-25). Operator coming
  // from the JWPK pitch "open a room → add a terminal → bring in a codex"
  // has just done step 1; surface the obvious next moves so they don't
  // have to grep `ant --help` again.
  const roomUrl = `${runtime.serverUrl.replace(/\/$/, '')}/rooms/${roomId}`;
  runtime.writeOut('');
  runtime.writeOut('Next steps:');
  runtime.writeOut(`  Open in browser:   ${roomUrl}`);
  runtime.writeOut(`  Bring in a codex:  ant agents bring-in --room ${roomId}`);
  runtime.writeOut(`  Invite an agent:   ant rooms invite ${roomId} @<handle>`);
  return 0;
}

async function listMembers(roomId, runtime) {
  if (!roomId) throw new CliInputError('rooms members needs a roomId');
  // GET /api/chat-rooms/:roomId hits requireChatRoomReadAccess (server)
  // which accepts pidChain query. Without the query the CLI 401s for
  // any caller who isn't admin-bearer — same pattern @speedycodex fixed
  // for room-list and chat-pending. Per the dual-side auth discipline.
  const response = await fetchFromServer(runtime, pathWithPidChain(`/api/chat-rooms/${roomId}`));
  await throwIfNotOk(response, runtime);
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
  await throwIfNotOk(response, runtime);
  runtime.writeOut(`Invited ${agentHandle} to ${roomId}`);
  return 0;
}

async function postMessage(roomId, body, runtime) {
  if (!roomId) throw new CliInputError('rooms post needs a roomId');
  if (!body || body.trim().length === 0) throw new CliInputError('rooms post needs a non-empty message');
  // `rooms post` is retained for old operators, but the witnessed write
  // path lives in `chat send`: durable session first, then bearer-backed
  // browser-session mint on daemon-witnessed 403s.
  return handleChatVerb('send', [roomId, '--msg', body], runtime, { CliInputError });
}

async function postBreak(roomId, reason, runtime) {
  if (!roomId) throw new CliInputError('rooms break needs a roomId');
  const trimmedReason = (reason ?? '').trim();
  // POST /api/chat-rooms/:roomId/breaks hits requireChatRoomMutationAuth
  // which parses pidChain from the BODY (not query). Without it, non-admin
  // callers 401 — same shape codex fixed for chat-pending and task PATCH.
  // Per the dual-side auth discipline (feedback_dual_side_auth_discipline_2026_05_25).
  const bodyPayload = { pidChain: processIdentityChain() };
  if (trimmedReason.length > 0) {
    bodyPayload.reason = trimmedReason;
    bodyPayload.postedByHandle = '@cli';
  }
  const response = await fetchFromServer(runtime, `/api/chat-rooms/${roomId}/breaks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyPayload)
  });
  await throwIfNotOk(response, runtime);
  const payload = await response.json();
  runtime.writeOut(`Break posted in ${roomId}: ${payload.message.body}`);
  return 0;
}

async function listMessages(roomId, runtime) {
  if (!roomId) throw new CliInputError('rooms messages needs a roomId');
  const body = await fetchRoomJsonWithBrowserSessionFallback(
    runtime,
    roomId,
    `/api/chat-rooms/${roomId}/messages`
  );
  for (const message of body.messages ?? []) {
    const tag = message.kind === 'system-break' ? '━━' : message.authorDisplayName;
    runtime.writeOut(`[${message.postedAt}] ${tag}: ${message.body}`);
  }
  return 0;
}

function loadAntConfig() {
  const configPath = join(homedir(), '.ant', 'config.json');
  try {
    if (!existsSync(configPath)) return {};
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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

function pathWithPidChain(path) {
  const url = new URL(path, 'http://ant.local');
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  return `${url.pathname}${url.search}`;
}

async function throwIfNotOk(response, runtime) {
  if (response.ok) return;
  // Stage A 403 PermissionDenied: when the server returns a structured
  // permission_denied block AND we have a runtime to write to, render
  // the 4-6 line UX-friendly response on stderr BEFORE we throw the
  // generic CliNetworkError. The exception still carries the body
  // message so non-permission_denied 403s + 401s land via the legacy
  // wedge-hint path in formatCallFailure.
  if (response.status === 403 && runtime !== undefined) {
    await renderPermissionDeniedIfPresent(response, runtime);
  }
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

// 0.1.8 slice D (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// when the server returns either of the two wedge-state signatures —
// 403 "Server-resolved identity required" (every write surface) or
// 400 "pids must be a non-empty array" (the lookup-by-pidChain
// surfaces) — surface a concrete recovery hint instead of letting
// the user re-read the cryptic server message. Both signatures
// indicate the caller's pidChain doesn't resolve to a registered
// terminal, which has one canonical fix: register from this shell.
const WEDGE_HINT = `
⚠ No terminal is registered for this shell (or the binding is stale).
  Recover by running:
    ant register --name <your-terminal-name> --handle <@your-handle>
  On Windows MSYS2 bash, if the implicit pidChain still anchors to a
  short-lived helper, pass --pid <stable-PID> to anchor to your long-
  lived shell (run \`ps\` and pick the bash or wezterm process).
  Re-running the same register is safe: it now declares the handle
  even on a fresh terminal (this fixes previously wedged shells).`;

function appendWedgeHintIfApplicable(rendered, message) {
  if (typeof message !== 'string') return rendered;
  if (!/Server-resolved identity required|pids must be a non-empty array/i.test(message)) {
    return rendered;
  }
  return `${rendered}\n${WEDGE_HINT}`;
}

export function formatCallFailure(causeOfFailure) {
  // Xeno 2026-05-22 follow-up: the previous shape returned the literal
  // string "Unknown error." for any non-Error non-CliNetworkError reject
  // (e.g. dynamic-import failures on compiled Bun binaries). That hid the
  // real cause for an entire release cycle. Always surface message + stack
  // when available so the next mystery can be diagnosed from the first
  // command output. CliNetworkError stays terse (it's user-friendly by
  // design); all other Errors get message + stack; non-Error rejects get
  // String()'d so at least the value is visible.
  if (causeOfFailure instanceof CliNetworkError) return causeOfFailure.message;
  if (causeOfFailure instanceof Error) {
    const stack = typeof causeOfFailure.stack === 'string' ? causeOfFailure.stack : '';
    const base = stack.length > 0 ? `${causeOfFailure.message}\n${stack}` : causeOfFailure.message;
    return appendWedgeHintIfApplicable(base, causeOfFailure.message);
  }
  if (causeOfFailure !== undefined && causeOfFailure !== null) {
    const rendered = String(causeOfFailure);
    return appendWedgeHintIfApplicable(rendered, rendered);
  }
  return 'Unknown error.';
}

function printUsage({ writeOut, serverUrl }) {
  writeOut(`ant — fresh-ant CLI (server: ${serverUrl} — override with ANT_SERVER_URL)

Verbs:
  whoami [--json]                      Which ANThandle is mine? (exit 0 bound / 2 no-handle / 3 unregistered)
  register --handle @h --name NAME     Register this terminal and declare its ANThandle (safe to re-run).
  chat send <room> (--msg|--msg-file|--stdin)   Post a message with the durable witnessed credential.
  helper pair|redeem|leases|revoke     Attachment lifecycle for paneless apps (NEVER paste pairing codes in rooms).
  rooms list|create|members|invite|break|messages   Manage rooms (to post, use ant chat send).
  connect --handle @h --name NAME       Connect this terminal and store its durable ANT credential.
  room members|add-member|aliases     Manage room admission and aliases.
  reaction list|add|remove|heard      Manage message reactions.
  status show --room ROOM_ID          Show pane/terminal delivery status per room member.
  delivery verify --terminal ID       Show delivery state (verified/stale/unknown) + reason.
  audit permissions --room ROOM_ID    Audit identity proofs for every room member.
  docs generate --from-cli            Generate manifest-derived markdown.
  deck build|list                     Build/list normal deck artefacts served at /d/SLUG.
  decks list|add|update|remove         Manage ANT Stage presentations served at /decks/ID.
  artefact add|list|remove             Add/list room artefact pointers, including deck and stage.
  linkedchat list|allow|deny          Manage terminal-scoped linked-chat permissions.
  fingerprint detect <terminal-id>    Detect agent kind via 5-source cascade.
  mcp list|grant|revoke               Manage MCP adapter grants (admin-bearer).
  grant <handle> <action> --room|--plan|--task|--org|--system ID [scope] [--revoke]
                                      Stage A permission grant (grants_shim).
  request approve|deny|list|show      Stage B permission_request workflow (approve/deny/list/show).
  vote create|list|show|cast|close    Open, inspect, cast, and close room/cross-room votes.
  remote admit|redeem|mapping         Remote ANT bridge admission + mapping management.
  router start --room ROOM --handle @h  Route mentions into a local terminal pane.
  remote-room send|status|ack|quarantine  Remote-bridge message ops (admin-bearer).
  stage focus|current                  Publish/read current deck focus for Stage.
  agents list|show|set|status|bring-in  List, configure, or spawn CLI agents (codex/pi).
  brief write|read|clear              Disposable per-terminal working-memory lane (compaction-survival).`);
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
