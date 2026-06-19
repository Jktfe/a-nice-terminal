// GET  /api/manual/suggestions — central feed, optionally filtered
// POST /api/manual/suggestions — capture a suggestion (Add button in
//                                inspector Notes section).
// Slice 3 (JWPK msg_6hmkenudej 2026-05-23). Suggestions are workspace data:
// callers need an authenticated ANT identity or admin-bearer, and capture
// attribution is resolved server-side.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createSuggestion,
  listSuggestions
} from '$lib/server/manualScreenStore';
import { resolveAggregateAuthActor } from '$lib/server/aggregateReadAuth';

export const GET: RequestHandler = async ({ request, url }) => {
  resolveAggregateAuthActor(request, '/api/manual/suggestions');
  const screenId = url.searchParams.get('screenId') ?? undefined;
  const stateSlug = url.searchParams.get('stateSlug') ?? undefined;
  const elementSlug = url.searchParams.get('elementSlug') ?? undefined;
  const rawStatus = url.searchParams.get('status');
  const status = rawStatus === 'open' || rawStatus === 'addressed' || rawStatus === 'dismissed'
    ? rawStatus : undefined;

  return json({
    suggestions: listSuggestions({ screenId, stateSlug, elementSlug, status })
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');
  const capturedByHandle = resolveAggregateAuthActor(request, '/api/manual/suggestions', body);

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length === 0) throw error(400, 'body required');
  if (text.length > 2000) throw error(400, 'body exceeds 2000 chars');

  const suggestion = createSuggestion({
    screenId: typeof body.screenId === 'string' && body.screenId.length > 0 ? body.screenId : null,
    stateSlug: typeof body.stateSlug === 'string' && body.stateSlug.length > 0 ? body.stateSlug : null,
    elementSlug: typeof body.elementSlug === 'string' && body.elementSlug.length > 0 ? body.elementSlug : null,
    body: text,
    capturedByHandle
  });
  return json({ suggestion }, { status: 201 });
};
