/**
 * /api/tags/[tagId]/audit — V2-server Phase A9 Slice 7b.
 *
 * GET -> 200 { events: TagLifecycleEvent[] }
 *   Returns the full lifecycle event chain for the tag (newest-first
 *   with rowid tie-break per the store invariant).
 *
 * Read endpoint — no auth required (audit visibility is part of the
 * trust surface; F1/F2 may scope this to org-admin for org/user tags).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listLifecycleEventsForTag } from '$lib/server/verificationTaxonomyStore';

export const GET: RequestHandler = async ({ params }) => {
  const tagId = params.tagId;
  if (!tagId) throw error(400, 'tagId required');
  const events = listLifecycleEventsForTag(tagId);
  return json({ events });
};
