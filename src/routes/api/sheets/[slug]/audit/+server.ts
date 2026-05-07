import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { readSheetAudit, readSheetMeta } from '$lib/server/sheets';
import { assertSheetAccess, requireSheetCaller } from '$lib/server/sheet-auth';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

export function GET(event: RequestEvent) {
  requireSheetCaller(event);
  const sheet = readSheetMeta(slugParam(event));
  if (!sheet) throw error(404, 'sheet not found');
  assertSheetAccess(event, sheet);
  const limit = Number(event.url.searchParams.get('limit') || 100);
  return json({ ok: true, sheet_slug: sheet.slug, events: readSheetAudit(sheet, limit) });
}
