// PATCH /api/manual/suggestions/:id — change suggestion status
// (open → addressed / dismissed) + optional addressed_note.
// Slice 3 (JWPK 2026-05-23) — central feed action surface.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';

const ALLOWED_STATUSES = new Set(['open', 'addressed', 'dismissed']);

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const status = typeof body.status === 'string' ? body.status : null;
  if (!status || !ALLOWED_STATUSES.has(status)) {
    throw error(400, `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`);
  }

  const addressedNote = typeof body.addressedNote === 'string' ? body.addressedNote : null;
  const addressedByHandle = typeof body.addressedByHandle === 'string' && body.addressedByHandle.length > 0
    ? body.addressedByHandle : null;

  const db = getIdentityDb();
  const isResolved = status === 'addressed' || status === 'dismissed';
  const result = db.prepare(
    `UPDATE manual_screen_suggestions
       SET status = ?,
           addressed_at_ms = ?,
           addressed_by_handle = ?,
           addressed_note = ?
       WHERE id = ?`
  ).run(
    status,
    isResolved ? Date.now() : null,
    isResolved ? addressedByHandle : null,
    isResolved ? addressedNote : null,
    id
  );
  if (result.changes === 0) throw error(404, 'suggestion not found');

  const row = db.prepare(`SELECT * FROM manual_screen_suggestions WHERE id = ?`).get(id);
  return json({ suggestion: row });
};
