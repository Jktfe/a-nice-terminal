/**
 * Read-side access control for chat-room data.
 *
 * This deliberately sits beside chatRoomAuthGate instead of reusing it:
 * write routes need author attribution and consent checks, while read routes
 * need fail-closed authentication plus server-side room filtering.
 */

import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'crypto';
import {
  bearerTokenFromHeader,
  resolveToken as resolveAntchatToken,
  userShapeForEmail as antchatUserShapeForEmail,
  normalizeAntchatEmail
} from './antchatAuthStore';
import { resolveAccountsBearerIdentity } from './accountsBearerIdentity';
import { verifyToken as verifyRoomInviteToken } from './chatInviteStore';
import {
  resolveBrowserSessionSecretIgnoringRoom,
  touchBrowserSessionLastSeen
} from './browserSessionStore';
import { getCookieValuesFromRequest } from './authGate';
import { resolveServerSideHandle, type PidChainEntry } from './identityGate';
import { findHandleForAliasInRoom } from './chatRoomAliasStore';
import type { ChatRoom } from './chatRoomStore';
import { expandHandlesToOwnerFamilies } from './agentFamilyStore';
import { lookupTerminalByPidChain } from './terminalsStore';
import { getTerminalRecord } from './terminalRecordsStore';
import { isOperatorHandle } from './operatorHandle';
import { getSession } from './antSessionStore';
import { resolveHandleForSession } from './membershipStore';
import {
  displayHandleForSession,
  isMember as hasActiveRoomHandleLease
} from './roomHandleLeaseClean';
import {
  evaluateTokenTerminalBinding,
  tokenBindingAction,
  tokenTerminalBindingMode,
  sessionFingerprint,
  terminalFp
} from './tokenTerminalBinding';

export type ChatRoomReadAccess = {
  isAdminBearer: boolean;
  source?:
    | 'admin-bearer'
    | 'local-bearer'
    | 'accounts-bearer'
    | 'browser-session'
    | 'pid-chain'
    | 'room-invite-bearer'
    | 'ant-session';
  handles: string[];
  principalHandles?: string[];
  resolvedRoomIds?: string[];
};

function tryAdminBearer(request: Request): boolean {
  const configured = process.env.ANT_ADMIN_TOKEN;
  if (!configured || configured.length === 0) return false;
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function addHandle(out: string[], rawHandle: unknown): void {
  if (typeof rawHandle !== 'string') return;
  const handle = normaliseHandle(rawHandle);
  if (handle.length === 0) return;
  if (!out.includes(handle)) out.push(handle);
}

/**
 * Org identity bridge: maps a bearer email to the family of handles that email
 * legitimately owns (current + historical), so a person keeps access to rooms
 * their older handles are members of while account-owned bindings land.
 *
 * The map is DATA, not code — it is a small set of real PII emails, so it is
 * NOT hard-coded here. It loads from the `ANT_ORG_HANDLE_MAP` env var as JSON
 * (`{"email@x":["@h1","@h2"]}`, keys lower-cased to match
 * normalizeAntchatEmail). Unset / malformed => empty map, so a stranger's
 * clone grants only the primary handle (correct OSS default) and no email
 * ships in source. The deployment provides the real map via secrets.env.
 *
 * Read fresh each call (no cache) so tests can set the env per-case and so
 * config edits take effect without a restart.
 */
function loadOrgHandleMap(): Record<string, string[]> {
  const raw = process.env.ANT_ORG_HANDLE_MAP;
  if (!raw || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>;
    }
  } catch {
    // Malformed map => empty (fail-closed to primary-handle-only).
  }
  return {};
}

function orgHandlesForEmail(email: string, primaryHandle: string): string[] {
  const normalisedEmail = normalizeAntchatEmail(email);
  const handles: string[] = [];
  addHandle(handles, primaryHandle);

  const extraHandles = loadOrgHandleMap()[normalisedEmail];
  if (Array.isArray(extraHandles)) {
    for (const extra of extraHandles) addHandle(handles, extra);
  }

  return handles;
}

/**
 * Resolve the full handle family for a bearer email. Includes the primary
 * handle + any org-mapped historical handles (from ANT_ORG_HANDLE_MAP, e.g.
 * an operator email → [@jamesK, @you, @james]) + agent family expansion for
 * alias-bound terminals.
 *
 * Exported so SSE-reducer clients (antchat / antios reactions M1) can
 * fetch the same family the server uses to gate reads and match incoming
 * `reactorHandle` deltas against the viewer. See homebrew + antios
 * eiw05zdurz msg_s21fibyq79 + msg_wv1pzydu8b 2026-05-27.
 */
export function handlesForEmail(email: string): string[] {
  const user = antchatUserShapeForEmail(email);
  return expandHandlesToOwnerFamilies(orgHandlesForEmail(user.email, user.handle));
}

function tryLocalAntchatBearer(request: Request): ChatRoomReadAccess | null {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;
  const record = resolveAntchatToken(token);
  if (!record) return null;
  const principalHandles = handlesForEmail(record.email);
  return {
    isAdminBearer: false,
    source: 'local-bearer',
    handles: principalHandles,
    principalHandles
  };
}

async function tryAccountsBearer(request: Request): Promise<ChatRoomReadAccess | null> {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;

  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity) return null;
  const principalHandles = [
    ...handlesForEmail(identity.email),
    ...identity.handles
  ];
  const handles = expandHandlesToOwnerFamilies([
    ...principalHandles
  ]);
  if (handles.length === 0) return null;

  return { isAdminBearer: false, source: 'accounts-bearer', handles, principalHandles };
}

// 0.1.8 slice C (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// invite-derived room tokens (from `ant invite exchange`) are bearers
// scoped to a single roomId, with an optional handle binding. Slice B
// in 0.1.6 made `/browser-session` skip the same-origin gate when ANY
// bearer is present, but `requireMintRoomAccess` downstream only knew
// about admin / local-antchat / accounts bearers — so a perfectly
// valid room-invite token still 401'd ("Authentication required").
// This resolver fills the gap. Requires roomId because verifyToken
// rejects cross-room reuse by design.
function tryRoomInviteBearer(request: Request, roomId?: string): ChatRoomReadAccess | null {
  if (!roomId) return null;
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;
  const identity = verifyRoomInviteToken(token, roomId);
  if (!identity) return null;
  // Handle is null until the invite is redeemed against a specific
  // alias. Room-scoped access still applies in that case — the room-id
  // match is the proof, not the handle.
  const principalHandles = identity.handle ? [normaliseHandle(identity.handle)] : [];
  return {
    isAdminBearer: false,
    source: 'room-invite-bearer',
    handles: expandHandlesToOwnerFamilies(principalHandles),
    principalHandles: principalHandles.length > 0 ? principalHandles : undefined,
    resolvedRoomIds: [roomId]
  };
}

function tryBrowserSession(request: Request, roomId?: string): ChatRoomReadAccess | null {
  const cookieSecrets = getCookieValuesFromRequest(request, 'ant_browser_session');
  for (const cookieSecret of cookieSecrets) {
    // Read gates use the cookie as identity proof; canReadChatRoom below is
    // the room-specific ACL. This lets a site-wide login cookie list/open any
    // room in the user's family before the room page mints a room-scoped
    // write cookie.
    const resolved = resolveBrowserSessionSecretIgnoringRoom(cookieSecret);
    if (resolved) {
      touchBrowserSessionLastSeen(resolved.session_id);
      const principalHandle = normaliseHandle(resolved.handle);
      return {
        isAdminBearer: false,
        source: 'browser-session',
        handles: expandHandlesToOwnerFamilies([principalHandle]),
        principalHandles: [principalHandle]
      };
    }
  }
  return null;
}

function extractAntSessionId(request: Request): string | null {
  const fromHeader = request.headers.get('x-ant-session-id')?.trim();
  return fromHeader && fromHeader.length > 0 ? fromHeader : null;
}

function tryAntSession(request: Request, roomId?: string): ChatRoomReadAccess | null {
  const sessionId = extractAntSessionId(request);
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  // Mirror the write gate's token→terminal binding (chatRoomAuthGate step 3c):
  // a session token lifted from one terminal must not authenticate reads from
  // a different terminal. Default mode is 'flag' (log-only); 'strict' rejects
  // only the 'wrong-terminal' case (active theft). CLI read callers already
  // pass ?pidChain=, which parsePidChainFromQuery reads.
  const bindingPidChain = parsePidChainFromQuery(request);
  const callerTerminal = lookupTerminalByPidChain(bindingPidChain);
  const binding = evaluateTokenTerminalBinding(
    session.terminal_id,
    callerTerminal?.id ?? null,
    bindingPidChain.length > 0
  );
  if (tokenBindingAction(binding) !== 'allow') {
    // eslint-disable-next-line no-console -- observability for the flag-phase rollout
    console.warn(
      `[token-binding:${tokenTerminalBindingMode()}] read room=${roomId ?? '-'} ` +
        `session_fp=${sessionFingerprint(session.id)} ` +
        `session_terminal_fp=${terminalFp(session.terminal_id)} ` +
        `caller_terminal_fp=${terminalFp(callerTerminal?.id ?? null)} ` +
        `kind=${binding.kind} hadPidChain=${bindingPidChain.length > 0}`
    );
    if (tokenBindingAction(binding) === 'reject') return null;
  }
  const handle = roomId
    ? hasActiveRoomHandleLease(roomId, session.id)
      ? displayHandleForSession(roomId, session.id) ?? resolveHandleForSession(roomId, session.id)
      : resolveHandleForSession(roomId, session.id)
    : (typeof session.label === 'string' ? normaliseHandle(session.label) : null);
  if (!handle) return null;
  const principalHandle = normaliseHandle(handle);
  return {
    isAdminBearer: false,
    source: 'ant-session',
    handles: expandHandlesToOwnerFamilies([principalHandle]),
    principalHandles: [principalHandle],
    ...(roomId && { resolvedRoomIds: [roomId] })
  };
}

function parsePidChainFromQuery(request: Request): PidChainEntry[] {
  const raw = new URL(request.url).searchParams.get('pidChain');
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const chain: PidChainEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const pidValue = (entry as { pid?: unknown }).pid;
    if (typeof pidValue !== 'number' || !Number.isFinite(pidValue) || pidValue <= 0) continue;
    const pidStartValue = (entry as { pid_start?: unknown }).pid_start;
    chain.push({
      pid: Math.floor(pidValue),
      pid_start: typeof pidStartValue === 'string' ? pidStartValue : null
    });
  }
  return chain;
}

function tryPidChainQuery(request: Request, roomId?: string): ChatRoomReadAccess | null {
  const pidChain = parsePidChainFromQuery(request);
  if (pidChain.length === 0) return null;

  // Room-scoped path: when we know the room, the room-scoped membership
  // handle wins (covers aliases + per-room rename).
  if (roomId) {
    const handle = resolveServerSideHandle(roomId, pidChain);
    if (!handle) return null;
    return {
      isAdminBearer: false,
      source: 'pid-chain',
      handles: expandHandlesToOwnerFamilies([normaliseHandle(handle)]),
      principalHandles: [normaliseHandle(handle)],
      resolvedRoomIds: [roomId]
    };
  }

  // Room-less path (e.g. GET /api/chat-rooms list): resolve the terminal
  // from the pidChain, return access keyed on the terminal's primary
  // handle so the upper layer can filter the list by membership via
  // canReadChatRoom. Fixes `ant rooms list` 401 surfaced in the first-day
  // user audit (docs/antchat-first-day-audit-2026-05-25.md): the CLI has
  // no bearer to pass, and the endpoint had no path through this resolver
  // because the early `if (!roomId) return null;` short-circuited every
  // call. Other read paths (chat send, message list) all pass a roomId
  // so they were unaffected — this is the listing-only gap.
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  // AUTHORITY decision (room-less room listing): use the unique-index-protected
  // `handle` ONLY, never deriveHandle's @slug(record.name) fallback — `name` is
  // self-declared at register, so a crafted name would let an unregistered
  // terminal list another member's rooms. Unregistered → null → no access.
  const record = getTerminalRecord(terminal.id);
  if (!record) return null;
  const primaryHandle = record.handle && record.handle.trim().length > 0 ? record.handle : null;
  if (!primaryHandle) return null;
  return {
    isAdminBearer: false,
    source: 'pid-chain',
    handles: expandHandlesToOwnerFamilies([normaliseHandle(primaryHandle)]),
    principalHandles: [normaliseHandle(primaryHandle)]
  };
}

/**
 * Per-resolver timing trace. Enabled by env `ANT_AUTH_GATE_DEBUG=1`.
 *
 * Banked in `project_auth_gate_latency_investigation_2026_05_24.md`:
 * the 3-21s 401 latency on /api/chat-rooms reported in the speed-pact-v0
 * plan has no obvious cause from static analysis. Likely suspects all
 * need actual timing data: tryAccountsBearer network call for token-
 * bearing 401s, slow upstream 200s, cold-DB warmup, busy_timeout=5000
 * chained reads. This wrapper lets the operator log per-resolver ms
 * timings without affecting the production hot path — when the env
 * isn't set, the wrapper is a no-op closure and the resolver order is
 * unchanged.
 *
 * Enable: `ANT_AUTH_GATE_DEBUG=1` in the launchd plist or shell, then
 * `launchctl kickstart -k gui/$UID/com.ant.server` and reproduce the
 * slow 401s. Lines land in /tmp/ant-server.log as:
 *   [auth-gate] tried=admin,local,accounts,roomInvite,browserSession,pidChain
 *               accountsMs=752 totalMs=812 result=null roomId=orsz2321qb
 */
const AUTH_GATE_DEBUG = process.env.ANT_AUTH_GATE_DEBUG === '1';

type AuthGateTrace = {
  start: number;
  steps: Array<{ name: string; ms: number; hit: boolean }>;
};

function startTrace(): AuthGateTrace | null {
  if (!AUTH_GATE_DEBUG) return null;
  return { start: performance.now(), steps: [] };
}

function traceStep(trace: AuthGateTrace | null, name: string, before: number, hit: boolean): void {
  if (!trace) return;
  trace.steps.push({ name, ms: Math.round(performance.now() - before), hit });
}

function endTrace(
  trace: AuthGateTrace | null,
  roomId: string | undefined,
  result: ChatRoomReadAccess | null
): void {
  if (!trace) return;
  const totalMs = Math.round(performance.now() - trace.start);
  const stepSummary = trace.steps
    .map((step) => `${step.name}${step.hit ? '*' : ''}=${step.ms}ms`)
    .join(',');
  const resultSummary = result === null ? 'null' : result.source ?? 'unknown';
  // Single-line log so it stays grep-friendly. The `*` marks the resolver
  // that actually succeeded (if any).
  process.stderr.write(
    `[auth-gate] ${stepSummary} totalMs=${totalMs} result=${resultSummary} roomId=${roomId ?? '-'}\n`
  );
}

export async function resolveChatRoomReadAccess(
  request: Request,
  roomId?: string
): Promise<ChatRoomReadAccess | null> {
  const trace = startTrace();

  let before = trace ? performance.now() : 0;
  if (tryAdminBearer(request)) {
    traceStep(trace, 'admin', before, true);
    const result: ChatRoomReadAccess = { isAdminBearer: true, source: 'admin-bearer', handles: [] };
    endTrace(trace, roomId, result);
    return result;
  }
  traceStep(trace, 'admin', before, false);

  before = trace ? performance.now() : 0;
  const localBearer = tryLocalAntchatBearer(request);
  traceStep(trace, 'local', before, localBearer !== null);
  if (localBearer) {
    endTrace(trace, roomId, localBearer);
    return localBearer;
  }

  before = trace ? performance.now() : 0;
  const accountsBearer = await tryAccountsBearer(request);
  traceStep(trace, 'accounts', before, accountsBearer !== null);
  if (accountsBearer) {
    endTrace(trace, roomId, accountsBearer);
    return accountsBearer;
  }

  before = trace ? performance.now() : 0;
  const roomInviteBearer = tryRoomInviteBearer(request, roomId);
  traceStep(trace, 'roomInvite', before, roomInviteBearer !== null);
  if (roomInviteBearer) {
    endTrace(trace, roomId, roomInviteBearer);
    return roomInviteBearer;
  }

  before = trace ? performance.now() : 0;
  const browserSession = tryBrowserSession(request, roomId);
  traceStep(trace, 'browserSession', before, browserSession !== null);
  if (browserSession) {
    endTrace(trace, roomId, browserSession);
    return browserSession;
  }

  before = trace ? performance.now() : 0;
  const antSession = tryAntSession(request, roomId);
  traceStep(trace, 'antSession', before, antSession !== null);
  if (antSession) {
    endTrace(trace, roomId, antSession);
    return antSession;
  }

  before = trace ? performance.now() : 0;
  const pidChain = tryPidChainQuery(request, roomId);
  traceStep(trace, 'pidChain', before, pidChain !== null);
  endTrace(trace, roomId, pidChain);
  return pidChain;
}

export function canReadChatRoom(room: ChatRoom, access: ChatRoomReadAccess): boolean {
  if (access.isAdminBearer) return true;
  if (access.resolvedRoomIds?.includes(room.id)) return true;
  for (const handle of access.handles) {
    if (isOperatorHandle(handle) && room.members.some((member) => isOperatorHandle(member.handle))) return true;
    if (room.members.some((member) => member.handle === handle)) return true;
    const globalHandle = findHandleForAliasInRoom(room.id, handle);
    if (room.members.some((member) => member.handle === globalHandle)) return true;
  }
  return false;
}

export async function requireChatRoomReadAccess(
  request: Request,
  room: ChatRoom
): Promise<ChatRoomReadAccess> {
  const access = await resolveChatRoomReadAccess(request, room.id);
  if (!access) {
    throw error(401, 'Authentication required.');
  }
  if (!canReadChatRoom(room, access)) {
    throw error(404, 'Room not found.');
  }
  return access;
}

export async function listReadableChatRooms(
  request: Request,
  rooms: ChatRoom[]
): Promise<ChatRoom[]> {
  const access = await resolveChatRoomReadAccess(request);
  if (!access) {
    throw error(401, 'Authentication required.');
  }
  if (access.isAdminBearer) return rooms;
  return rooms.filter((room) => canReadChatRoom(room, access));
}
