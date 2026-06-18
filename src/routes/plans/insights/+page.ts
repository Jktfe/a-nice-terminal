import type { PageLoad } from './$types';
import type { PlansInsights } from '$lib/server/planInsightsStore';

function messageForInsightsFetchFailure(status: number | null): string {
  if (status === 401 || status === 403) {
    return 'Could not load plan insights because this dashboard needs an authenticated operator session.';
  }
  if (status) {
    return `Could not load plan insights. The server returned HTTP ${status}.`;
  }
  return 'Could not load plan insights. Check the connection and try again.';
}

export const load: PageLoad = async ({ fetch }) => {
  try {
    const res = await fetch('/api/plans/insights');
    if (!res.ok) {
      return {
        insights: null,
        insightsFetchFailed: true,
        insightsFetchStatus: res.status,
        insightsFetchMessage: messageForInsightsFetchFailure(res.status)
      };
    }
    const insights = ((await res.json()) as { insights: PlansInsights }).insights;
    return {
      insights,
      insightsFetchFailed: false,
      insightsFetchStatus: null,
      insightsFetchMessage: null
    };
  } catch {
    return {
      insights: null,
      insightsFetchFailed: true,
      insightsFetchStatus: null,
      insightsFetchMessage: messageForInsightsFetchFailure(null)
    };
  }
};
