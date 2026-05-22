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

export type ChatRoomReadAccess = {
  isAdminBearer: boolean;
  source?: 'admin-bearer' | 'local-bearer' | 'accounts-bearer' | 'browser-session' | 'pid-chain' | 'room-invite-bearer';
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

function orgHandlesForEmail(email: string, primaryHandle: string): string[] {
  const normalisedEmail = normalizeAntchatEmail(email);
  const handles: string[] = [];
  addHandle(handles, primaryHandle);

  // P0 bridge for New Model's current org identities while account-owned
  // handle bindings land. Keep historical handles here so James keeps access
  // to @you rooms, but do not grant those handles to james+m5.
  if (normalisedEmail === 'james@newmodel.vc') {
    addHandle(handles, '@jamesK');
    addHandle(handles, '@you');
    addHandle(handles, '@james');
  } else if (normalisedEmail === 'j.stephenson@newmodel.vc') {
    addHandle(handles, '@stevo');
    addHandle(handles, '@jstephenson');
  } else if (normalisedEmail === 'mark@newmodel.vc') {
    addHandle(handles, '@mark');
  } else if (normalisedEmail === 'james+m5@newmodel.vc') {
    addHandle(handles, '@jamesm5');
  }

  return handles;
}

function handlesForEmail(email: string): string[] {
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
  if (!roomId) return null;
  const handle = resolveServerSideHandle(roomId, parsePidChainFromQuery(request));
  if (!handle) return null;
  return {
    isAdminBearer: false,
    source: 'pid-chain',
    handles: expandHandlesToOwnerFamilies([normaliseHandle(handle)]),
    principalHandles: [normaliseHandle(handle)],
    resolvedRoomIds: [roomId]
  };
}

export async function resolveChatRoomReadAccess(
  request: Request,
  roomId?: string
): Promise<ChatRoomReadAccess | null> {
  if (tryAdminBearer(request)) return { isAdminBearer: true, source: 'admin-bearer', handles: [] };

  const localBearer = tryLocalAntchatBearer(request);
  if (localBearer) return localBearer;

  const accountsBearer = await tryAccountsBearer(request);
  if (accountsBearer) return accountsBearer;

  const roomInviteBearer = tryRoomInviteBearer(request, roomId);
  if (roomInviteBearer) return roomInviteBearer;

  const browserSession = tryBrowserSession(request, roomId);
  if (browserSession) return browserSession;

  return tryPidChainQuery(request, roomId);
}

export function canReadChatRoom(room: ChatRoom, access: ChatRoomReadAccess): boolean {
  if (access.isAdminBearer) return true;
  if (access.resolvedRoomIds?.includes(room.id)) return true;
  for (const handle of access.handles) {
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
