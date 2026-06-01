/**
 * /api/tools/[tool_id]/deprecate — PR-D soft-deprecate endpoint.
 *
 * POST (admin) → flag a tool as deprecated. Still usable, but ledgered
 * for removal. Distinct from retire (which is destructive — orphans
 * grants).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { findToolById, deprecateTool } from '$lib/server/toolsCatalogStore';

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const toolId = params.tool_id ?? '';
  if (toolId.length === 0) throw error(400, 'tool_id required');
  const existing = findToolById(toolId);
  if (!existing) throw error(404, 'tool not found');
  const tool = deprecateTool(toolId);
  return json({ tool });
};
