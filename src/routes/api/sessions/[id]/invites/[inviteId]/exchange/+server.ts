import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { exchangePassword, type InviteKind } from '$lib/server/room-invites';

const KIND_VALUES: ReadonlySet<string> = new Set(['cli', 'mcp', 'web']);

// Bad-password handling: option (b) — auto-revoke after MAX_FAILED_ATTEMPTS
// (env: ANT_INVITE_MAX_FAILURES, default 5). Counter resets on successful
// exchange. We keep returning 401 even after auto-revoke so a brute-forcer
// can't tell when they tripped the wall. Legitimate users see the revoked
// state in the right-rail UI.
export async function POST({ params, request }: RequestEvent<{ id: string; inviteId: string }>) {
  const room = queries.getSession(params.id);
  if (!room) throw error(404, 'Room not found');

  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const kindRaw = typeof body.kind === 'string' ? body.kind : '';
  if (!KIND_VALUES.has(kindRaw)) throw error(400, 'kind must be cli|mcp|web');
  const kind = kindRaw as InviteKind;
  const handle = typeof body.handle === 'string' ? body.handle : null;
  const meta = typeof body.meta === 'object' && body.meta !== null ? body.meta : {};

  const invite = queries.getRoomInvite(params.inviteId) as any;
  if (!invite || invite.room_id !== params.id) throw error(404, 'Invite not found');
  if (invite.revoked_at) throw error(403, 'Invite revoked');

  const result = exchangePassword({
    inviteId: params.inviteId,
    password,
    kind,
    handle,
    meta,
  });

  if (!result) throw error(401, 'Invalid password or kind not allowed');

  return json({
    token: result.token,
    token_id: result.tokenId,
    invite_id: result.inviteId,
    room_id: result.roomId,
    kind: result.kind,
    handle: result.handle,
  });
}
