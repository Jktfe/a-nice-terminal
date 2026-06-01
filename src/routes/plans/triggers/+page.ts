/**
 * /plans/triggers — universal load. Fetches the public read endpoints
 * for triggers + plans in parallel; soft-fails to empty arrays so the
 * page still renders if either endpoint is unhappy. The event/action
 * const sets come from the sibling +page.server.ts (which can safely
 * import from $lib/server).
 */

import type { PageLoad } from './$types';
import type { PlanTrigger } from '$lib/server/planTriggerStore';
import type { PlanRecord } from '$lib/server/planStore';

export const load: PageLoad = async ({ fetch, data }) => {
  const [triggersRes, plansRes] = await Promise.all([
    fetch('/api/plan-triggers').catch(() => null),
    fetch('/api/plans?state=all').catch(() => null)
  ]);

  let triggers: PlanTrigger[] = [];
  if (triggersRes && triggersRes.ok) {
    const body = (await triggersRes.json().catch(() => null)) as { triggers?: PlanTrigger[] } | null;
    if (body && Array.isArray(body.triggers)) triggers = body.triggers;
  }

  let plans: PlanRecord[] = [];
  if (plansRes && plansRes.ok) {
    const body = (await plansRes.json().catch(() => null)) as { plans?: PlanRecord[] } | null;
    if (body && Array.isArray(body.plans)) plans = body.plans;
  }

  return {
    ...data, // events + actions from +page.server.ts
    triggers,
    plans
  };
};
