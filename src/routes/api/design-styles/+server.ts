/**
 * GET /api/design-styles — list banked styles.
 * POST /api/design-styles — create a new style.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listDesignStyles,
  createDesignStyle,
  isAllowedDesignStyleKind,
  isAllowedDesignStyleScope
} from '$lib/server/designStyleStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

function requireAuth(request: Request): void {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const scope = url.searchParams.get('scope') as 'org' | 'user' | 'public' | null;
  const scopeId = url.searchParams.get('scopeId') ?? undefined;
  const kind = url.searchParams.get('kind') as 'palette' | 'font' | 'asset' | 'spacing' | 'shadow' | 'border' | null;
  const tag = url.searchParams.get('tag') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  if (scope && !isAllowedDesignStyleScope(scope)) {
    throw error(400, 'scope must be org|user|public');
  }
  if (kind && !isAllowedDesignStyleKind(kind)) {
    throw error(400, 'kind must be palette|font|asset|spacing|shadow|border');
  }

  const styles = listDesignStyles({
    ...(scope && { scope }),
    ...(scopeId && { scopeId }),
    ...(kind && { kind }),
    ...(tag && { tag }),
    ...(limit && { limit })
  });

  return json({ styles });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAuth(request);
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw error(400, 'JSON body required.');
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (name.length === 0) throw error(400, 'name is required.');

  const kind = payload.kind;
  if (!isAllowedDesignStyleKind(kind)) throw error(400, 'kind must be palette|font|asset|spacing|shadow|border');

  const scope = payload.scope;
  if (!isAllowedDesignStyleScope(scope)) throw error(400, 'scope must be org|user|public');

  const scopeId = typeof payload.scopeId === 'string' ? payload.scopeId.trim() : '';
  if (scopeId.length === 0) throw error(400, 'scopeId is required.');

  const style = createDesignStyle({
    name,
    kind,
    scope,
    scopeId,
    data: typeof payload.data === 'object' && payload.data !== null ? payload.data as Record<string, unknown> : {},
    tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [],
    isDefault: payload.isDefault === true,
    createdBy: '@admin'
  });

  return json({ style }, { status: 201 });
};
