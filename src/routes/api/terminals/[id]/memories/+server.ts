/**
 * GET /api/terminals/:id/memories
 *
 * Convenience filter — equivalent to
 * /api/memories?scope=terminal&target=:id, but lives under the canonical
 * terminal route so existing terminal-page UIs can fetch their scoped
 * memory rows without knowing the wider /api/memories shape.
 *
 * Per the JWPK 2026-05-16 verb spec this backs `ant terminal <name>
 * listmemories`.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { listMemoriesForScope } from '$lib/server/memoriesStore';

export const GET: RequestHandler = async ({ params, request }) => {
  requireOperatorLikeAuth(request);
  const terminalId = params.id;
  const memories = listMemoriesForScope('terminal', terminalId ?? null);
  return json({ memories });
};
