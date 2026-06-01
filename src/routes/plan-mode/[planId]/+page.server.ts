/**
 * Plan Mode route — server load.
 *
 * Reads projection directly from planModeStore (pm-store baseline) and
 * passes a snapshot to the page. The store is server-side and single-
 * process; an HTTP roundtrip to /api/plan/:planId would be pure overhead.
 * The endpoint remains the public surface for CLI + external callers.
 *
 * Per Plan Mode Contract §3: SSR-first render. Archived events are
 * hidden by default; ?include_archived=true keeps them visible.
 */

import type { PageServerLoad } from './$types';
import { projectPlanEvents, type PlanEvent } from '$lib/server/planModeStore';

export const load: PageServerLoad = async ({ params, url }) => {
  const planId = params.planId ?? '';
  const allEvents = projectPlanEvents(planId);
  const includeArchived = url.searchParams.get('include_archived') === 'true';
  const visibleEvents: PlanEvent[] = includeArchived
    ? allEvents
    : allEvents.filter((event) => event.status !== 'archived');
  return {
    snapshot: { planId, events: visibleEvents, includeArchived }
  };
};
