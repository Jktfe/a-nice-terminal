/**
 * GET /api/plans/insights — Lane-D cross-plan analytics.
 *
 * Public read (no auth — same posture as /api/plans/completions). The
 * Cache-Control short max-age keeps rapid-refresh dashboards cheap on
 * SQLite while still feeling live.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { computeInsights } from '$lib/server/planInsightsStore';

export const GET: RequestHandler = async () => {
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
