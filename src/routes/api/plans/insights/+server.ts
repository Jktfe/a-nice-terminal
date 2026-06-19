/**
 * GET /api/plans/insights — Lane-D cross-plan analytics.
 *
 * rv1 data-scoping fix: this is a SERVER-WIDE aggregate (cross-plan counts /
 * rollups) that cannot be partitioned per room without leaking the global
 * shape. It is therefore admin-bearer OR configured-operator-browser only
 * (containment), mirroring the no-room aggregate path on /api/tasks.
 * Non-operator callers get 401 rather than a global analytics surface. The
 * Cache-Control short max-age keeps rapid-refresh operator dashboards cheap on
 * SQLite while still feeling live.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { computeInsights } from '$lib/server/planInsightsStore';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'Authentication required.');
  }
  const insights = computeInsights();
  return json(
    { insights },
    {
      headers: {
        'cache-control': 'public, max-age=10'
      }
    }
  );
};
