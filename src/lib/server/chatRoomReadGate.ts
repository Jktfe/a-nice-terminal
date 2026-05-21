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
import {
  resolveBrowserSessionSecretIgnoringRoom,
  touchBrowserSessionLastSeen
} from './browserSessionStore';
import { getCookieValuesFromRequest } from './authGate';
import { findHandleForAliasInRoom } from './chatRoomAliasStore';
import type { ChatRoom } from './chatRoomStore';
import { expandHandlesToOwnerFamilies } from './agentFamilyStore';

export type ChatRoomReadAccess = {
  isAdminBearer: boolean;
  handles: string[];
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
  if (normalisedEmail === 'redacted@example.com') {
    addHandle(handles, '@jamesK');
    addHandle(handles, '@you');
    addHandle(handles, '@james');
  } else if (normalisedEmail === 'redacted@example.com') {
    addHandle(handles, '@stevo');
    addHandle(handles, '@jstephenson');
  } else if (normalisedEmail === 'redacted@example.com') {
    addHandle(handles, '@mark');
  } else if (normalisedEmail === 'redacted@example.com') {
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
  return { isAdminBearer: false, handles: handlesForEmail(record.email) };
}

async function tryAccountsBearer(request: Request): Promise<ChatRoomReadAccess | null> {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;

  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity) return null;
  const handles = expandHandlesToOwnerFamilies([
    ...handlesForEmail(identity.email),
    ...identity.handles
  ]);
  if (handles.length === 0) return null;

  return { isAdminBearer: false, handles };
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
      return {
        isAdminBearer: false,
        handles: expandHandlesToOwnerFamilies([normaliseHandle(resolved.handle)])
      };
    }
  }
  return null;
}

export async function resolveChatRoomReadAccess(
  request: Request,
  roomId?: string
): Promise<ChatRoomReadAccess | null> {
  if (tryAdminBearer(request)) return { isAdminBearer: true, handles: [] };

  const localBearer = tryLocalAntchatBearer(request);
  if (localBearer) return localBearer;

  const accountsBearer = await tryAccountsBearer(request);
  if (accountsBearer) return accountsBearer;

  return tryBrowserSession(request, roomId);
}

export function canReadChatRoom(room: ChatRoom, access: ChatRoomReadAccess): boolean {
  if (access.isAdminBearer) return true;
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
