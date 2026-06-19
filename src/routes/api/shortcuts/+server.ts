/**
 * HTTP endpoints for scope-aware shortcuts.
 *
 * GET  /api/shortcuts?scope=terminal&target=<id>
 *      Returns { shortcuts } for that (scope, target) bucket.
 *      scope=global needs no target. Missing/empty params fall back to
 *      400 with a clear message.
 *
 * POST /api/shortcuts
 *      Body: { scope, scope_target?, label, command, order_index? }
 *      Returns { shortcut } 201 on success, 400 on validation failure.
 *
 * Persistence lives in src/lib/server/shortcutsStore.ts (better-sqlite3).
 * Shortcut commands can drive local tools, so reads and writes require
 * operator-level auth.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  addShortcut,
  listShortcutsFor,
  type ShortcutScope
} from '$lib/server/shortcutsStore';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

const VALID_SCOPES: ReadonlySet<ShortcutScope> = new Set<ShortcutScope>([
  'terminal',
  'chatroom',
  'global'
]);

function parseScope(raw: unknown): ShortcutScope {
  if (typeof raw !== 'string' || !VALID_SCOPES.has(raw as ShortcutScope)) {
    throw error(400, "Field 'scope' must be one of terminal, chatroom, global.");
  }
  return raw as ShortcutScope;
}

export const GET: RequestHandler = async ({ request, url }) => {
  requireOperatorLikeAuth(request);
  const scope = parseScope(url.searchParams.get('scope'));
  if (scope === 'global') {
    return json({ shortcuts: listShortcutsFor('global') });
  }
  const target = url.searchParams.get('target')?.trim() ?? '';
  if (target.length === 0) {
    throw error(400, `Query param 'target' is required when scope=${scope}.`);
  }
  return json({ shortcuts: listShortcutsFor(scope, target) });
};

export const POST: RequestHandler = async ({ request }) => {
  requireOperatorLikeAuth(request);
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with scope, label, command.');
  }

  const body = rawBody as {
    scope?: unknown;
    scope_target?: unknown;
    label?: unknown;
    command?: unknown;
    order_index?: unknown;
    created_by?: unknown;
  };
  const scope = parseScope(body.scope);

  if (typeof body.label !== 'string') {
    throw error(400, "Field 'label' must be a string.");
  }
  if (typeof body.command !== 'string') {
    throw error(400, "Field 'command' must be a string.");
  }

  let scopeTarget: string | null = null;
  if (scope !== 'global') {
    if (typeof body.scope_target !== 'string' || body.scope_target.trim().length === 0) {
      throw error(400, `Field 'scope_target' is required when scope=${scope}.`);
    }
    scopeTarget = body.scope_target.trim();
  } else if (body.scope_target !== undefined && body.scope_target !== null) {
    if (typeof body.scope_target !== 'string' || body.scope_target.trim().length > 0) {
      throw error(400, "Field 'scope_target' must be null/omitted when scope=global.");
    }
  }

  let orderIndex: number | undefined;
  if (body.order_index !== undefined) {
    if (typeof body.order_index !== 'number' || !Number.isFinite(body.order_index)) {
      throw error(400, "Field 'order_index' must be a finite number.");
    }
    orderIndex = body.order_index;
  }

  const createdBy =
    typeof body.created_by === 'string' && body.created_by.trim().length > 0
      ? body.created_by.trim()
      : null;

  try {
    const shortcut = addShortcut({
      scope,
      scopeTarget,
      label: body.label,
      command: body.command,
      orderIndex,
      createdBy
    });
    return json({ shortcut }, { status: 201 });
  } catch (causeOfFailure) {
    if (causeOfFailure instanceof Response) throw causeOfFailure;
    const maybeHttp = causeOfFailure as { status?: number };
    if (typeof maybeHttp?.status === 'number') throw causeOfFailure;
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not add shortcut.';
    throw error(400, message);
  }
};
