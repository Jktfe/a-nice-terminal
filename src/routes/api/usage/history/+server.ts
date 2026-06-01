/**
 * GET /api/usage/history?limit=N — newest-first usage_snapshots feed
 * for the trend chart on /terminals. JWPK msg_4rbn05cztw antV4
 * 2026-05-28.
 *
 * Query params:
 *   - `limit`: optional integer 1..360 (default 60 ≈ 30 days at 12 h
 *     cadence). Out-of-range values get clamped silently rather than
 *     400-ing, since this is a read endpoint with no security impact.
 *
 * Returns: `{ snapshots: UsageSnapshotRow[] }` so the response shape
 * is stable if we add aggregate fields (avg/peak) later.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRecentUsageSnapshots } from '$lib/server/usageSnapshotStore';

const DEFAULT_LIMIT = 60;

export const GET: RequestHandler = async ({ url }) => {
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  const snapshots = listRecentUsageSnapshots(Number.isFinite(limit) ? limit : DEFAULT_LIMIT);
  return json({ snapshots });
};
