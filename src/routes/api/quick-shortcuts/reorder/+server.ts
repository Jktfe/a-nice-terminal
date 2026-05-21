/**
 * Bulk-reorder the global Quick Shortcuts list.
 *
 * POST /api/quick-shortcuts/reorder body { ids: string[] } → 200 { shortcuts }
 *
 * The provided ids set their order_index to position (0-indexed). Unknown
 * ids are ignored silently — the chip bar UI may post a stale list mid-
 * concurrent-edit; that should not 4xx the request.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reorderQuickShortcuts } from '$lib/server/quickShortcutsStore';

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with an ids array.');
  }

  const idsFromBody = (rawBody as { ids?: unknown }).ids;
  if (!Array.isArray(idsFromBody)) {
    throw error(400, 'The ids field must be an array of strings.');
  }
  for (const candidate of idsFromBody) {
    if (typeof candidate !== 'string') {
      throw error(400, 'Every entry in ids must be a string.');
    }
  }

  const shortcuts = reorderQuickShortcuts(idsFromBody as string[]);
  return json({ shortcuts });
};
