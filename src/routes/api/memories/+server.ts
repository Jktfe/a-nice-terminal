/**
 * HTTP endpoints for the memory CRUD subsystem (MEMORY-CRUD 2026-05-16).
 *
 * GET  /api/memories?prefix=&scope=&target=
 *   List memory rows. With `prefix` (and no scope), filters keys by prefix.
 *   With `scope` (global/terminal/room), filters by scope + optional target.
 *   With both, the scope filter wins and prefix is applied client-side by
 *   the caller (keeps the SQL paths simple).
 *
 * POST /api/memories
 *   Body: { key, value, scope?, scope_target?, byHandle? }
 *   Upserts by key. Returns { memory, created } where `created=true` when
 *   the row was freshly inserted, false when an existing row was updated.
 *
 * Key-by-path read/delete live at /api/memories/key/[...key]/+server.ts.
 * Audit read lives at /api/memories/audit/+server.ts.
 *
 * Auth: read/write require a browser/antchat identity, a local pidChain, or
 * admin-bearer. The write audit actor is resolved server-side; callers cannot
 * spoof `byHandle` in the request body.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth, resolveAggregateAuthActor } from '$lib/server/aggregateReadAuth';
import {
  listMemoriesByPrefix,
  listMemoriesForScope,
  putMemory,
  type MemoryScope
} from '$lib/server/memoriesStore';

function parseScopeParam(raw: string | null): MemoryScope | null {
  if (!raw) return null;
  if (raw === 'global' || raw === 'terminal' || raw === 'room') return raw;
  return null;
}

export const GET: RequestHandler = async ({ request, url }) => {
  requireAggregateReadAuth(request, '/api/memories');
  const scopeParam = parseScopeParam(url.searchParams.get('scope'));
  const targetParam = url.searchParams.get('target');
  const prefixParam = url.searchParams.get('prefix');

  if (scopeParam) {
    const memories = listMemoriesForScope(scopeParam, targetParam);
    return json({ memories });
  }
  const memories = listMemoriesByPrefix(prefixParam ?? '');
  return json({ memories });
};

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least key + value fields.');
  }
  const actorHandle = resolveAggregateAuthActor(request, '/api/memories', rawBody);
  const body = rawBody as Record<string, unknown>;
  const key = body.key;
  const value = body.value;
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw error(400, 'The key field must be a non-empty string.');
  }
  if (typeof value !== 'string') {
    throw error(400, 'The value field must be a string.');
  }
  const scopeRaw = typeof body.scope === 'string' ? body.scope : null;
  const scope = parseScopeParam(scopeRaw) ?? (scopeRaw === null ? null : null);
  if (scopeRaw !== null && scopeRaw !== '' && scope === null) {
    throw error(400, `scope must be one of global, terminal, room (got "${scopeRaw}").`);
  }
  const scopeTargetRaw =
    typeof body.scope_target === 'string'
      ? body.scope_target
      : typeof body.scopeTarget === 'string'
        ? body.scopeTarget
        : null;
  try {
    const result = putMemory({
      key,
      value,
      scope: scope ?? 'global',
      scopeTarget: scopeTargetRaw,
      byHandle: actorHandle
    });
    return json(result, { status: result.created ? 201 : 200 });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not write memory.';
    throw error(400, message);
  }
};
