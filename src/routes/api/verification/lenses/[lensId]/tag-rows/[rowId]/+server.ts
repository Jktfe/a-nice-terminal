/**
 * /api/verification/lenses/[lensId]/tag-rows/[rowId] — V2-server A9 Slice 7b.
 *
 * DELETE -> 204 no content (row removed)
 *        -> 404 row not found
 *
 * Per the substrate invariant lens_tag_rows is mutable (rows can be
 * added + removed during lens authoring). Audit history for lens
 * changes lives on verification_lens_audit (existing endpoint).
 *
 * Auth: admin-bearer (substrate boundary).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteLensTagRow, getLensTagRow } from '$lib/server/lensTagRowsStore';

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_BEARER;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  const lensId = params.lensId;
  const rowId = params.rowId;
  if (!lensId || !rowId) throw error(400, 'lensId + rowId required');

  // Cross-check the row belongs to this lens (defense-in-depth against
  // path-traversal-style mismatches where lensId is wrong but rowId
  // exists under a different lens).
  const existing = getLensTagRow(rowId);
  if (!existing) throw error(404, `lens tag row ${rowId} not found`);
  if (existing.lensId !== lensId) {
    throw error(404, `lens tag row ${rowId} does not belong to lens ${lensId}`);
  }

  const removed = deleteLensTagRow(rowId);
  if (!removed) throw error(404, `lens tag row ${rowId} could not be deleted`);
  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = async ({ params }) => {
  const lensId = params.lensId;
  const rowId = params.rowId;
  if (!lensId || !rowId) throw error(400, 'lensId + rowId required');
  const row = getLensTagRow(rowId);
  if (!row) throw error(404, `lens tag row ${rowId} not found`);
  if (row.lensId !== lensId) {
    throw error(404, `lens tag row ${rowId} does not belong to lens ${lensId}`);
  }
  return json({ row });
};
