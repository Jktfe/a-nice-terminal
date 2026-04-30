import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import {
  createInvite,
  listInvitesForRoom,
  listTokensForInvite,
  buildShareString,
  serializeKinds,
  parseKinds,
  MAX_FAILED_ATTEMPTS,
  type InviteKind,
  type InviteRow,
} from '$lib/server/room-invites';

function publicInvite(invite: InviteRow, serverUrl: string) {
  const kinds = parseKinds(invite.kinds);
  return {
    id: invite.id,
    room_id: invite.room_id,
    label: invite.label,
    kinds,
    created_by: invite.created_by,
    created_at: invite.created_at,
    revoked_at: invite.revoked_at,
    failed_attempts: invite.failed_attempts,
    last_failed_at: invite.last_failed_at,
    max_failed_attempts: MAX_FAILED_ATTEMPTS,
    share: Object.fromEntries(kinds.map((k) => [k, buildShareString({ serverUrl, roomId: invite.room_id, inviteId: invite.id, kind: k })])),
    tokens: listTokensForInvite(invite.id).map((t) => ({
      id: t.id,
      kind: t.kind,
      handle: t.handle,
      created_at: t.created_at,
      last_seen_at: t.last_seen_at,
      revoked_at: t.revoked_at,
    })),
  };
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const room = queries.getSession(params.id);
  if (!room) throw error(404, 'Room not found');
  const serverUrl = process.env.ANT_SERVER_URL || `${url.protocol}//${url.host}`;
  const invites = listInvitesForRoom(params.id).map((i) => publicInvite(i, serverUrl));
  return json({ invites });
}

export async function POST({ params, request, url }: RequestEvent<{ id: string }>) {
  const room = queries.getSession(params.id);
  if (!room) throw error(404, 'Room not found');

  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!label) throw error(400, 'label required');
  if (password.length < 4) throw error(400, 'password must be at least 4 characters');

  const requestedKinds = Array.isArray(body.kinds)
    ? body.kinds.filter((k: unknown): k is InviteKind => typeof k === 'string' && (k === 'cli' || k === 'mcp' || k === 'web'))
    : undefined;

  const createdBy = typeof body.created_by === 'string' ? body.created_by : null;

  const invite = createInvite({
    roomId: params.id,
    label,
    password,
    kinds: requestedKinds,
    createdBy,
  });

  const serverUrl = process.env.ANT_SERVER_URL || `${url.protocol}//${url.host}`;
  return json({ invite: publicInvite(invite, serverUrl), kinds: parseKinds(invite.kinds), serialized_kinds: serializeKinds(parseKinds(invite.kinds)) }, { status: 201 });
}
