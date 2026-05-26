/**
 * GET /api/cli-version/latest — surfaces the latest published ant CLI
 * release for the Settings page (NMT feedback #E from @jstephenson via
 * @james, 2026-05-26): users on stale CLIs need a one-click view of
 * what to upgrade to.
 *
 * Data path lives in `$lib/server/cliReleaseCache.ts` (1-hour in-memory
 * cache, stale-fallback on upstream failure). This handler is a thin
 * wire surface.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLatestCliRelease } from '$lib/server/cliReleaseCache';

export const GET: RequestHandler = async () => {
  try {
    const payload = await getLatestCliRelease();
    return json(payload);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(502, `failed to fetch latest CLI release: ${message}`);
  }
};
