/**
 * GET    /api/chat-rooms/[roomId]/operator-invites
 *   → 200 { invites: OperatorInvite[] }   newest-first.
 *
 * POST   /api/chat-rooms/[roomId]/operator-invites
 *   body { label, password, kinds: ('cli'|'mcp'|'web')[] }
 *   → 201 { invite: OperatorInvite }
 *
 * Both require the operator browser session (cookie resolves to @you in
 * this room). Wraps the existing chatInviteStore primitives — the
 * /api/chat-invites endpoint is admin-bearer-gated for CLI/automation
 * paths, this one is the operator's browser equivalent.
 *
 * Returns per-kind share strings alongside the invite metadata so the
 * UI can render shareable links without round-tripping for the URLs.
 *
 * v3-lift glue: the underlying chatInviteStore is the v4 equivalent of
 * the v3 room-invites system (scrypt password + multi-kind tokens). All
 * I'm adding here is the operator-only browser auth surface so the
 * RemoteInviteModal can mint invites without holding ANT_ADMIN_TOKEN.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCookieValuesFromRequest } from '$lib/server/authGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveBrowserSessionSecret } from '$lib/server/browserSessionStore';
import { getOperatorHandle, isOperatorHandle } from '$lib/server/operatorHandle';
import {
  createInvite,
  listActiveInvitesWithUsageForRoom,
  type InviteKind,
  type PublicInviteWithUsage,
  type PublicInviteSummary
} from '$lib/server/chatInviteStore';

const ALLOWED_KIND_VALUES: readonly InviteKind[] = ['cli', 'mcp', 'web'];

type OperatorInvite = PublicInviteSummary & {
  share: Record<InviteKind, string>;
};

type OperatorInviteWithUsage = PublicInviteWithUsage & {
  share: Record<InviteKind, string>;
};

function requireOperatorBrowserSession(request: Request, roomId: string): void {
  const cookies = getCookieValuesFromRequest(request, 'ant_browser_session');
  if (cookies.length === 0) throw error(403, 'Operator browser session required.');
  let sawNonOperatorSession = false;
  for (const cookie of cookies) {
    const resolved = resolveBrowserSessionSecret(cookie, roomId);
    if (resolved && isOperatorHandle(resolved.handle)) return;
    if (resolved) sawNonOperatorSession = true;
  }
  if (sawNonOperatorSession) throw error(403, 'Only the operator can manage invites.');
  throw error(403, 'Operator browser session required.');
}

function publicOrigin(url: URL): string {
  if (process.env.ANT_PUBLIC_ORIGIN) return process.env.ANT_PUBLIC_ORIGIN;
  if (process.env.ANT_SERVER_URL) return process.env.ANT_SERVER_URL;
  return `${url.protocol}//${url.host}`;
}

function buildShareString(opts: {
  serverUrl: string;
  roomId: string;
  inviteId: string;
  kind: InviteKind;
}): string {
  const u = new URL(opts.serverUrl);
  if (opts.kind === 'cli') {
    return `ant://${u.host}/r/${opts.roomId}?invite=${opts.inviteId}`;
  }
  if (opts.kind === 'mcp') {
    return `${u.protocol}//${u.host}/mcp/room/${opts.roomId}?invite=${opts.inviteId}`;
  }
  return `${u.protocol}//${u.host}/r/${opts.inviteId}`;
}

function withShares(summary: PublicInviteSummary, serverUrl: string): OperatorInvite {
  const share = Object.fromEntries(
    summary.kinds.map((kind) => [
      kind,
      buildShareString({ serverUrl, roomId: summary.room_id, inviteId: summary.id, kind })
    ])
  ) as Record<InviteKind, string>;
  return { ...summary, share };
}

function withUsageShares(summary: PublicInviteWithUsage, serverUrl: string): OperatorInviteWithUsage {
  return { ...summary, share: withShares(summary, serverUrl).share };
}

function parseRequestedKinds(raw: unknown): InviteKind[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is InviteKind =>
      typeof value === 'string' && (ALLOWED_KIND_VALUES as readonly string[]).includes(value)
  );
}

export const GET: RequestHandler = ({ params, request, url }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  requireOperatorBrowserSession(request, params.roomId);
  const serverUrl = publicOrigin(url);
  const invites = listActiveInvitesWithUsageForRoom(params.roomId)
    .toSorted((left, right) => right.created_at.localeCompare(left.created_at))
    .map((row) => withUsageShares(row, serverUrl));
  return json({ invites });
};

export const POST: RequestHandler = async ({ params, request, url }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, 'Room not found.');
  requireOperatorBrowserSession(request, params.roomId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const labelRaw = (body as Record<string, unknown>).label;
  const passwordRaw = (body as Record<string, unknown>).password;
  const kindsRaw = (body as Record<string, unknown>).kinds;

  if (typeof labelRaw !== 'string' || labelRaw.trim().length === 0) {
    throw error(400, 'label is required');
  }
  if (typeof passwordRaw !== 'string' || passwordRaw.length < 4) {
    throw error(400, 'password must be at least 4 characters');
  }
  const kinds = parseRequestedKinds(kindsRaw);
  if (kinds.length === 0) {
    throw error(400, 'kinds must include at least one of cli|mcp|web');
  }

  const summary = createInvite({
    roomId: params.roomId,
    label: labelRaw.trim(),
    password: passwordRaw,
    kinds,
    createdBy: getOperatorHandle()
  });

  return json({ invite: withShares(summary, publicOrigin(url)) }, { status: 201 });
};
