import type { PageLoad } from './$types';
import type { PlansInsights } from '$lib/server/planInsightsStore';

export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch('/api/plans/insights');
  const insights = res.ok
    ? ((await res.json()) as { insights: PlansInsights }).insights
    : null;
  return { insights };
};
