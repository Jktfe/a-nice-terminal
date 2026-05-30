/**
 * /api/tools/[tool_id] — PR-D tools catalog single-tool endpoint.
 *
 * GET     /api/tools/[tool_id]  (open read) → fetch a tool by id.
 * DELETE  /api/tools/[tool_id]  (admin)     → retire the tool. Grants
 *                                              pointing at it become
 *                                              orphans for the audit
 *                                              surface to catch.
 *
 * Deprecate lives at /api/tools/[tool_id]/deprecate so the soft-flag
 * isn't conflated with retire — they're distinct lifecycle states.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { findToolById, retireTool } from '$lib/server/toolsCatalogStore';

export const GET: RequestHandler = async ({ params }) => {
  const toolId = params.tool_id ?? '';
  if (toolId.length === 0) throw error(400, 'tool_id required');
  const tool = findToolById(toolId);
  if (!tool) throw error(404, 'tool not found');
  return json({ tool });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireAdminAuth(request);
  const toolId = params.tool_id ?? '';
  if (toolId.length === 0) throw error(400, 'tool_id required');
  const existing = findToolById(toolId);
  if (!existing) throw error(404, 'tool not found');
  const tool = retireTool(toolId);
  return json({ tool });
};
