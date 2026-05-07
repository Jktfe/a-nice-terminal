import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listSheets, registerSheet, writeSheetManifest } from '$lib/server/sheets';
import { assertCanWrite } from '$lib/server/room-scope';
import { requireSheetCaller } from '$lib/server/sheet-auth';

export function GET(event: RequestEvent) {
  const caller = requireSheetCaller(event);
  const sheets = listSheets().filter((sheet) =>
    caller.admin || sheet.allowed_room_ids.includes(caller.scope.roomId)
  );
  return json({ ok: true, sheets });
}

export async function POST(event: RequestEvent) {
  const caller = requireSheetCaller(event);
  if (!caller.admin) assertCanWrite(event);

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!slug) throw error(400, 'slug required');

  const requestedRooms = Array.isArray(body.allowed_room_ids)
    ? body.allowed_room_ids.filter((roomId: unknown): roomId is string => typeof roomId === 'string' && roomId.length > 0)
    : [];
  const owner = caller.admin
    ? (typeof body.owner_session_id === 'string' ? body.owner_session_id : requestedRooms[0] ?? '')
    : caller.scope.roomId;
  if (!owner) throw error(400, 'owner_session_id required');
  const allowedRooms = caller.admin
    ? requestedRooms
    : Array.from(new Set([caller.scope.roomId, ...requestedRooms]));

  const sheet = registerSheet({
    slug,
    owner_session_id: owner,
    allowed_room_ids: allowedRooms,
    sheet_dir: typeof body.sheet_dir === 'string' ? body.sheet_dir : null,
    dev_port: Number.isFinite(Number(body.dev_port)) ? Number(body.dev_port) : null,
  });
  const manifest = writeSheetManifest(sheet);

  return json({ ok: true, sheet, manifest }, { status: 201 });
}
