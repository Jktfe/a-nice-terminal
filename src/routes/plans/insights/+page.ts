import type { PageLoad } from './$types';
import type { PlansInsights } from '$lib/server/planInsightsStore';

function normaliseHandle(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return (trimmed.startsWith('@') ? trimmed : `@${trimmed}`).toLowerCase();
}

async function canReadOperatorInsights(fetch: Parameters<PageLoad>[0]['fetch']): Promise<boolean> {
  const response = await fetch('/api/capabilities').catch(() => null);
  if (!response?.ok) return false;
  const body = (await response.json().catch(() => null)) as {
    operatorHandle?: string;
    viewerHandle?: string | null;
  } | null;
  const operatorHandle = normaliseHandle(body?.operatorHandle);
  const viewerHandle = normaliseHandle(body?.viewerHandle);
  return operatorHandle.length > 0 && viewerHandle.length > 0 && operatorHandle === viewerHandle;
}

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
  const operatorInsightsReadable = await canReadOperatorInsights(fetch);
  if (!operatorInsightsReadable) {
    return {
      insights: null,
      insightsLocked: true,
      insightsFetchFailed: false,
      insightsFetchStatus: null,
      insightsFetchMessage: null
    };
  }

  try {
    const res = await fetch('/api/plans/insights');
    if (!res.ok) {
      return {
        insights: null,
        insightsLocked: false,
        insightsFetchFailed: true,
        insightsFetchStatus: res.status,
        insightsFetchMessage: messageForInsightsFetchFailure(res.status)
      };
    }
    const insights = ((await res.json()) as { insights: PlansInsights }).insights;
    return {
      insights,
      insightsLocked: false,
      insightsFetchFailed: false,
      insightsFetchStatus: null,
      insightsFetchMessage: null
    };
  } catch {
    return {
      insights: null,
      insightsLocked: false,
      insightsFetchFailed: true,
      insightsFetchStatus: null,
      insightsFetchMessage: messageForInsightsFetchFailure(null)
    };
  }
};
