import type { PageServerLoad } from './$types';
import { getPlanViewData } from '$lib/server/projector/plan-view.js';

export const load: PageServerLoad = ({ url }) => {
  return getPlanViewData({
    sessionId: url.searchParams.get('session_id'),
    planId: url.searchParams.get('plan_id'),
    limit: url.searchParams.get('limit'),
  });
};
