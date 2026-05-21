/**
 * GET /api/plans/completions — Lane-D PLANS S1.
 *
 * Plans-index donut feed: completion ratio per DISTINCT non-null plan_id.
 * Standalone tasks (plan_id NULL) are excluded by design — they render in
 * an "Unfiled" board lane, not as a plan donut.
 *
 * Query (mutually exclusive — `deleted` > `archived` > `active` > default):
 *   `?deleted=1`  → only plans whose plans-row has deleted_at_ms set.
 *                   Used by the "Show deleted" toggle on /plans.
 *   `?archived=1` → only plans whose plans-row has archived_at_ms set AND
 *                   deleted_at_ms NULL. Used by the "Show archived" toggle.
 *   `?active=1`   → only plans with at least one non-deleted, non-completed
 *                   task AND not archived/deleted. The /plans index default.
 *   (no flag)     → all plans with any non-deleted task. Original gated S1
 *                   contract — unchanged. Includes archived + active alike.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listPlanCompletions,
  listActivePlanCompletions,
  listArchivedPlanCompletions,
  listDeletedPlanCompletions
} from '$lib/server/taskStore';

export const GET: RequestHandler = async ({ url }) => {
  const deletedOnly = url.searchParams.get('deleted') === '1';
  const archivedOnly = url.searchParams.get('archived') === '1';
  const activeOnly = url.searchParams.get('active') === '1';
  const plans = deletedOnly
    ? listDeletedPlanCompletions()
    : archivedOnly
      ? listArchivedPlanCompletions()
      : activeOnly
        ? listActivePlanCompletions()
        : listPlanCompletions();
  return json({ plans });
};
