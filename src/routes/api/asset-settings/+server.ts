/**
 * GET  /api/asset-settings  → { envRoots, fileRoots, resolved }
 * PUT  /api/asset-settings  body { assetRoots: string[] }  → updated file roots
 *
 * Lets the Settings panel show what the asset-root resolution looks like
 * (env layer, file layer, the merged effective order with the static/
 * fallback last) and let an operator edit the file layer without
 * touching their shell rc.
 *
 * The env var ANT_ASSET_ROOTS stays canonical — PUT only writes the
 * file layer (~/.ant/asset-folders.json). If the operator wants to
 * change the env-var entries, they edit their shell rc as before.
 *
 * Auth: admin-bearer OR the configured operator's browser session — only
 * the local operator should be able to see / edit which folders on their
 * machine are asset roots.
 *
 * JWPK msg_7nqg8oaufo: served images must NOT live in the repo
 * (OSS-leak risk); they live in an external user-configurable folder,
 * and a user can add files by hand. This route is the read/write
 * companion to ~/.ant/asset-folders.json.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { delimiter } from 'node:path';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import {
  readAssetFolderSettings,
  writeAssetFolderSettings,
  assetRootsResolved
} from '$lib/server/assetFolderSettingsStore';

function envLayer(): string[] {
  return (process.env.ANT_ASSET_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function payload() {
  const settings = readAssetFolderSettings();
  return {
    envRoots: envLayer(),
    fileRoots: settings.assetRoots,
    resolved: assetRootsResolved()
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
    | { assetRoots?: unknown }
    | null;
  if (!body || !Array.isArray(body.assetRoots)) {
    throw error(400, 'Body must be {"assetRoots": [string, ...]}');
  }
  try {
    writeAssetFolderSettings({ assetRoots: body.assetRoots });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'write failed';
    throw error(400, message);
  }
  return json(payload());
};
