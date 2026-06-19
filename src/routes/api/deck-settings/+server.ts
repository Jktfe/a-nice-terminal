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
 * Auth: admin-bearer OR the configured operator's browser session — only
 * the local operator should be able to see / edit which folders on their
 * machine are deck roots.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { delimiter } from 'node:path';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
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
  const settings = readDeckSettings();
  return {
    envRoots: envLayer(),
    fileRoots: settings.decksRoots,
    roomOverrides: settings.roomOverrides ?? {},
    resolved: deckRootsResolved()
  };
}

function requireAdminOrOperator(request: Request): void {
  if (tryAdminBearer(request) || tryOperatorSession(request)) return;
  throw error(401, 'admin-bearer or operator session required');
}

export const GET: RequestHandler = async ({ request }) => {
  requireAdminOrOperator(request);
  return json(payload());
};

export const PUT: RequestHandler = async ({ request }) => {
  requireAdminOrOperator(request);
  const body = (await request.json().catch(() => null)) as
    | { decksRoots?: unknown; roomOverrides?: unknown }
    | null;
  if (!body || !Array.isArray(body.decksRoots)) {
    throw error(400, 'Body must be {"decksRoots": [string, ...]} (roomOverrides optional)');
  }
  try {
    // Pass roomOverrides through only when explicitly set (undefined =
    // preserve existing per the store contract).
    if (body.roomOverrides !== undefined) {
      writeDeckSettings({ decksRoots: body.decksRoots, roomOverrides: body.roomOverrides });
    } else {
      writeDeckSettings({ decksRoots: body.decksRoots });
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'write failed';
    throw error(400, message);
  }
  return json(payload());
};
