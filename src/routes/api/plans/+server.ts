import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listPlanRefs, parseIncludeArchived } from '$lib/server/projector/plan-view.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

export function GET({ url }: RequestEvent) {
  const limit = parseLimit(url.searchParams.get('limit'));
  const includeArchived = parseIncludeArchived(url.searchParams.get('include_archived'));
  const plans = listPlanRefs(limit, { includeArchived });
  return json({ count: plans.length, include_archived: includeArchived, plans });
}
