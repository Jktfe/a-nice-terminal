import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listSheetFiles, readSheetManifest, readSheetMeta } from '$lib/server/sheets';
import { assertSheetAccess, requireSheetCaller } from '$lib/server/sheet-auth';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

export function GET(event: RequestEvent) {
  requireSheetCaller(event);
  const sheet = readSheetMeta(slugParam(event));
  if (!sheet) throw error(404, 'sheet not found');
  assertSheetAccess(event, sheet);
  return json({ ok: true, sheet, files: listSheetFiles(sheet), manifest: readSheetManifest(sheet) });
}
