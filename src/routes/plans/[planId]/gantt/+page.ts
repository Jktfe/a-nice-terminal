/**
 * /plans/[planId]/gantt loader — fetches the plan envelope so the page
 * heading + title can render before the (heavier) task fetch resolves.
 * The task fetch itself lives in the page's onMount path so the Gantt
 * component mounts after hydration.
 */

import type { PageLoad } from './$types';

type PlanEnvelope = { plan?: { id?: string; title?: string | null } };

export const load: PageLoad = async ({ params, fetch }) => {
  const planId = params.planId ?? '';
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`);
    if (!response.ok) {
      return { planId, planTitle: null };
    }
    const body = (await response.json()) as PlanEnvelope;
    return { planId, planTitle: body.plan?.title ?? null };
  } catch {
    return { planId, planTitle: null };
  }
};
