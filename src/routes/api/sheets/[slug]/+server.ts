import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { readSheetManifest, readSheetMeta, registerSheet, writeSheetManifest } from '$lib/server/sheets';
import { assertSheetAccess, requireSheetCaller } from '$lib/server/sheet-auth';
import { assertCanWrite } from '$lib/server/room-scope';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function assertOwner(event: RequestEvent, ownerSessionId: string): void {
  const caller = requireSheetCaller(event);
  if (caller.admin) return;
  assertCanWrite(event);
  if (caller.scope.roomId !== ownerSessionId) {
    throw error(403, 'Only the sheet owner room can update this sheet');
  }
}

export function GET(event: RequestEvent) {
  requireSheetCaller(event);
  const sheet = readSheetMeta(slugParam(event));
  if (!sheet) throw error(404, 'sheet not found');
  assertSheetAccess(event, sheet);
  return json({ ok: true, sheet, manifest: readSheetManifest(sheet) });
}

export async function PATCH(event: RequestEvent) {
  const existing = readSheetMeta(slugParam(event));
  if (!existing) throw error(404, 'sheet not found');
  assertOwner(event, existing.owner_session_id);

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const sheet = registerSheet({
    slug: slugParam(event),
    owner_session_id: existing.owner_session_id,
    allowed_room_ids: Array.isArray(body.allowed_room_ids)
      ? body.allowed_room_ids.filter((roomId: unknown): roomId is string => typeof roomId === 'string' && roomId.length > 0)
      : existing.allowed_room_ids,
    sheet_dir: typeof body.sheet_dir === 'string' ? body.sheet_dir : existing.sheet_dir,
    dev_port: body.dev_port === null ? null : Number.isFinite(Number(body.dev_port)) ? Number(body.dev_port) : existing.dev_port,
  });
  const manifest = writeSheetManifest(sheet);

  return json({ ok: true, sheet, manifest });
}

export function DELETE(event: RequestEvent) {
  const existing = readSheetMeta(slugParam(event));
  if (!existing) throw error(404, 'sheet not found');
  assertOwner(event, existing.owner_session_id);
  queries.deleteSheet(existing.slug);
  return json({ ok: true, slug: existing.slug });
}
