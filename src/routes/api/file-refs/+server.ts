/**
 * HTTP endpoints for file_refs (JWPK file-refs / "flag" subsystem 2026-05-16).
 *
 * GET  /api/file-refs?scope=&target=&path=  → list. At least one of
 *   scope (with target when scope!=global) or path must be set; otherwise
 *   400 to keep the endpoint from accidentally dumping the whole table.
 * POST /api/file-refs                       → create one ref and return it.
 *
 * v3 served this as /api/sessions/<id>/file-refs (terminal-scoped only);
 * fresh-ANT generalises to terminal | chatroom | global scopes.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  addFileRef,
  listFileRefsByPath,
  listFileRefsForScope,
  type FileRefScope
} from '$lib/server/fileRefsStore';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

const VALID_SCOPES: ReadonlySet<FileRefScope> = new Set(['terminal', 'chatroom', 'global']);

function asScope(raw: string | null): FileRefScope | null {
  if (raw === null) return null;
  return VALID_SCOPES.has(raw as FileRefScope) ? (raw as FileRefScope) : null;
}

export const GET: RequestHandler = async ({ request, url }) => {
  requireOperatorLikeAuth(request);
  const rawScope = url.searchParams.get('scope');
  const rawTarget = url.searchParams.get('target');
  const rawPath = url.searchParams.get('path');

  if (rawScope === null && rawPath === null) {
    throw error(400, 'Provide ?scope=terminal|chatroom|global (+target=...) or ?path=...');
  }

  if (rawPath !== null && rawScope === null) {
    return json({ fileRefs: listFileRefsByPath(rawPath) });
  }

  const scope = asScope(rawScope);
  if (scope === null) {
    throw error(400, 'scope must be one of terminal | chatroom | global.');
  }
  if (scope !== 'global' && (rawTarget === null || rawTarget.trim().length === 0)) {
    throw error(400, `target is required when scope is "${scope}".`);
  }
  return json({ fileRefs: listFileRefsForScope(scope, rawTarget ?? undefined) });
};

export const POST: RequestHandler = async ({ request }) => {
  requireOperatorLikeAuth(request);
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least file_path and scope.');
  }
  const body = rawBody as Record<string, unknown>;

  const filePath = typeof body.file_path === 'string' ? body.file_path : '';
  if (filePath.trim().length === 0) {
    throw error(400, 'file_path is required.');
  }

  const scope = asScope(typeof body.scope === 'string' ? body.scope : null);
  if (scope === null) {
    throw error(400, 'scope must be one of terminal | chatroom | global.');
  }

  const scopeTargetRaw = typeof body.scope_target === 'string' ? body.scope_target : null;
  if (scope !== 'global' && (scopeTargetRaw === null || scopeTargetRaw.trim().length === 0)) {
    throw error(400, `scope_target is required when scope is "${scope}".`);
  }

  const label = typeof body.label === 'string' ? body.label : null;
  const description = typeof body.description === 'string' ? body.description : null;
  const flaggedBy = typeof body.flagged_by === 'string' ? body.flagged_by : null;

  try {
    const created = addFileRef({
      filePath,
      scope,
      scopeTarget: scopeTargetRaw,
      label,
      description,
      flaggedBy
    });
    return json({ fileRef: created }, { status: 201 });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not add file_ref.';
    throw error(400, message);
  }
};
