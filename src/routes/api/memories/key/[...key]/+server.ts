/**
 * GET    /api/memories/key/<key>   → fetch one memory row by key.
 * DELETE /api/memories/key/<key>   → hard-delete + audit-log the value.
 *
 * Uses SvelteKit's rest param `[...key]` so slashes inside the key
 * (e.g. "agents/researchant/role") survive routing without double
 * URL-encoding. Callers can pass either the literal slashes or the
 * encoded "%2F" form — both resolve to the same lookup.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMemory, getMemory } from '$lib/server/memoriesStore';

function resolveKey(rawKey: string | undefined): string {
  if (!rawKey || rawKey.length === 0) {
    throw error(400, 'Memory key is required in the URL path.');
  }
  // SvelteKit already URL-decodes path segments; the [...key] rest param
  // joins them with '/'. If the caller passed a double-encoded slash
  // (%252F), they will see literal "%2F" here — decode once more so the
  // stored key shape matches the canonical form.
  return rawKey.replace(/%2F/gi, '/');
}

export const GET: RequestHandler = async ({ params }) => {
  const key = resolveKey(params.key);
  const memory = getMemory(key);
  if (!memory) {
    throw error(404, `No memory at key "${key}".`);
  }
  return json({ memory });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const key = resolveKey(params.key);
  const byHandle = url.searchParams.get('byHandle');
  const wasDeleted = deleteMemory(key, byHandle);
  if (!wasDeleted) {
    throw error(404, `No memory at key "${key}".`);
  }
  return new Response(null, { status: 204 });
};
