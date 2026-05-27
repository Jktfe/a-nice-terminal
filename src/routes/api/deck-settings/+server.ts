/**
 * GET /api/deck-settings  → { envRoots, fileRoots, resolved }
 * PUT /api/deck-settings  body { decksRoots: string[] }  → updated file roots
 *
 * Lets the Settings panel show what the deck-root resolution looks like
 * (env layer, file layer, the merged effective order) and let an
 * operator edit the file layer without touching their shell rc.
 *
 * The env var ANT_BUILT_DECKS_ROOTS stays canonical — PUT only writes
 * the file layer (~/.ant/deck-settings.json). If the operator wants to
 * change the env-var entries, they edit their shell rc as before.
 *
 * Auth: admin-bearer only — only the local operator should be able to
 * see / edit which folders on their machine are deck roots.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { delimiter } from 'node:path';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import {
  readDeckSettings,
  writeDeckSettings,
  deckRootsResolved
} from '$lib/server/deckSettingsStore';

function envLayer(): string[] {
  return (process.env.ANT_BUILT_DECKS_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function payload() {
  return {
    envRoots: envLayer(),
    fileRoots: readDeckSettings().decksRoots,
    resolved: deckRootsResolved()
  };
}

export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request)) throw error(401, 'admin bearer required');
  return json(payload());
};

export const PUT: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request)) throw error(401, 'admin bearer required');
  const body = (await request.json().catch(() => null)) as
    | { decksRoots?: unknown }
    | null;
  if (!body || !Array.isArray(body.decksRoots)) {
    throw error(400, 'Body must be {"decksRoots": [string, ...]}');
  }
  try {
    writeDeckSettings({ decksRoots: body.decksRoots });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'write failed';
    throw error(400, message);
  }
  return json(payload());
};
