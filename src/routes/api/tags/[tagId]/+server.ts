/**
 * /api/tags/[tagId] — V2-server Phase A9 Slice 7b: per-tag detail.
 *
 * GET -> 200 { tag: TagDefinition } (the latest active version)
 *      -> 404 tag not found
 *
 * Read endpoint — no auth required for read; the substrate keeps tag
 * definitions readable so verification consumers can resolve historical
 * applications against their original tag definition without auth gates.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLatestTagVersion, getTagVersion } from '$lib/server/verificationTaxonomyStore';

export const GET: RequestHandler = async ({ params, url }) => {
  const tagId = params.tagId;
  if (!tagId) throw error(400, 'tagId required');
  // Optional ?version=N for historical lookups (replayable audit).
  const versionParam = url.searchParams.get('version');
  if (versionParam !== null) {
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      throw error(400, 'version must be a positive integer');
    }
    const tag = getTagVersion(tagId, version);
    if (!tag) throw error(404, `tag ${tagId} version ${version} not found`);
    return json({ tag });
  }
  const tag = getLatestTagVersion(tagId);
  if (!tag) throw error(404, `tag ${tagId} not found`);
  return json({ tag });
};
