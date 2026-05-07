import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { existsSync, statSync } from 'fs';
import { extname } from 'path';
import {
  SheetConflictError,
  defaultSheetDirForSlug,
  deleteSheetPath,
  sheetMaxFileBytes,
  readSheetBytes,
  readSheetMeta,
  registerSheet,
  writeSheetBytes,
} from '$lib/server/sheets';
import { assertSheetAccess, requireSheetCaller } from '$lib/server/sheet-auth';
import { assertCanWrite } from '$lib/server/room-scope';
import { broadcast } from '$lib/server/ws-broadcast';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function pathParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).path ?? '');
}

// MIME types lean spreadsheet — xlsx canonical name lives at
// src/lib/server/uploads/index.ts:32. CSV / TSV / ODS round out the common
// sheet formats; everything else falls through to octet-stream.
function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.tsv':
      return 'text/tab-separated-values; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function callerActor(caller: ReturnType<typeof requireSheetCaller>): string {
  if (caller.admin) return 'admin';
  return `${caller.scope.kind || 'room'}:${caller.scope.roomId}`;
}

function writeGuard(event: RequestEvent, actor: string) {
  const rawHash = event.request.headers.get('x-ant-base-hash') || event.url.searchParams.get('base_hash');
  const rawMtime = event.request.headers.get('x-ant-if-match-mtime') || event.url.searchParams.get('if_match_mtime');
  const ifMatchMtime = rawMtime == null || rawMtime === '' ? null : Number(rawMtime);
  return {
    base_hash: rawHash || null,
    if_match_mtime: Number.isFinite(ifMatchMtime) ? ifMatchMtime : null,
    actor,
  };
}

function broadcastSheetEvent(sheet: NonNullable<ReturnType<typeof readSheetMeta>>, payload: Record<string, unknown>) {
  for (const roomId of sheet.allowed_room_ids) {
    broadcast(roomId, {
      type: 'sheet_updated',
      sheet_slug: sheet.slug,
      ...payload,
    });
  }
}

function mapSheetError(err: unknown): never {
  if (err instanceof SheetConflictError) throw error(409, err.message);
  const message = err instanceof Error ? err.message : String(err);
  if (/traversal|outside|invalid bytes|not editable/i.test(message)) throw error(400, message);
  if (/too large|exceeds max/i.test(message)) throw error(413, message);
  if (/not a file|ENOENT|no such file/i.test(message)) throw error(404, 'file not found');
  if (/directories/i.test(message)) throw error(400, message);
  throw error(400, message);
}

export function GET(event: RequestEvent) {
  requireSheetCaller(event);
  const sheet = readSheetMeta(slugParam(event));
  if (!sheet) throw error(404, 'sheet not found');
  assertSheetAccess(event, sheet);
  try {
    const file = readSheetBytes(sheet, pathParam(event));
    return new Response(file.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType(file.path),
        'Content-Length': String(file.size),
        'Cache-Control': 'no-store',
        'ETag': `"${file.sha256}"`,
        'X-ANT-Sheet-Sha256': file.sha256,
        'X-ANT-Sheet-Mtime-Ms': String(file.mtime_ms),
      },
    });
  } catch (err) {
    mapSheetError(err);
  }
}

export async function PUT(event: RequestEvent) {
  const caller = requireSheetCaller(event);
  if (!caller.admin) assertCanWrite(event);

  let sheet = readSheetMeta(slugParam(event));
  if (!sheet) {
    if (caller.admin) throw error(404, 'sheet not found');
    const sheetDir = defaultSheetDirForSlug(slugParam(event));
    if (!existsSync(sheetDir) || !statSync(sheetDir).isDirectory()) throw error(404, 'sheet not found');
    sheet = registerSheet({
      slug: slugParam(event),
      owner_session_id: caller.scope.roomId,
      allowed_room_ids: [caller.scope.roomId],
      sheet_dir: sheetDir,
    });
  }
  assertSheetAccess(event, sheet, { write: true });

  const bytes = Buffer.from(await event.request.arrayBuffer());
  if (bytes.byteLength > sheetMaxFileBytes()) throw error(413, 'file exceeds max size');
  try {
    const written = writeSheetBytes(sheet, pathParam(event), bytes, writeGuard(event, callerActor(caller)));
    broadcastSheetEvent(sheet, {
      action: 'file_write',
      path: written.path,
      size: written.size,
      sha256: written.sha256,
    });
    return json({ ok: true, ...written });
  } catch (err) {
    mapSheetError(err);
  }
}

export function DELETE(event: RequestEvent) {
  const caller = requireSheetCaller(event);
  const sheet = readSheetMeta(slugParam(event));
  if (!sheet) throw error(404, 'sheet not found');
  assertSheetAccess(event, sheet, { write: true });
  try {
    const deleted = deleteSheetPath(sheet, pathParam(event), writeGuard(event, callerActor(caller)));
    broadcastSheetEvent(sheet, {
      action: 'file_delete',
      path: deleted.path,
    });
    return json({ ok: true, ...deleted });
  } catch (err) {
    mapSheetError(err);
  }
}
