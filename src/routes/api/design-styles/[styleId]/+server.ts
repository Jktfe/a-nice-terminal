/**
 * GET /api/design-styles/:styleId — get a style.
 * PATCH /api/design-styles/:styleId — update a style.
 * DELETE /api/design-styles/:styleId — delete a style.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDesignStyle, updateDesignStyle, deleteDesignStyle } from '$lib/server/designStyleStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

function requireAuth(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
}

export const GET: RequestHandler = async ({ params }) => {
  const style = getDesignStyle(params.styleId);
  if (!style) throw error(404, 'Style not found.');
  return json({ style });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireAuth(request);
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const style = updateDesignStyle(params.styleId, {
    name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
    data: typeof payload.data === 'object' && payload.data !== null ? payload.data as Record<string, unknown> : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : undefined,
    isDefault: typeof payload.isDefault === 'boolean' ? payload.isDefault : undefined
  });

  if (!style) throw error(404, 'Style not found.');
  return json({ style });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  requireAuth(request);
  const ok = deleteDesignStyle(params.styleId);
  if (!ok) throw error(404, 'Style not found.');
  return json({ ok: true });
};
