// GET /api/manual/states/:screenId/:stateSlug/annotations/:elementSlug/audit
// Slice 6 (JWPK 2026-05-24 audit purpose, msg_pklmhllqx1): returns the
// append-only edit history for a single annotation. Newest-first, limit
// 50 by default (overridable via ?limit=N up to 200).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAuditForElement } from '$lib/server/manualScreenStore';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET: RequestHandler = async ({ params, request, url }) => {
  requireAggregateReadAuth(
    request,
    '/api/manual/states/:screenId/:stateSlug/annotations/:elementSlug/audit'
  );
  const screenId = params.screenId ?? '';
  const stateSlug = params.stateSlug ?? '';
  const elementSlug = params.elementSlug ?? '';
  if (!screenId || !stateSlug || !elementSlug) throw error(400, 'screenId, stateSlug, elementSlug required');

  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.round(rawLimit)))
    : DEFAULT_LIMIT;

  return json({
    audit: listAuditForElement(screenId, stateSlug, elementSlug, limit)
  });
};
