/**
 * /api/orgs/[orgId] — single org read (F1 substrate).
 *
 * - GET (open read) returns the org row + 404 if missing.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrg } from '$lib/server/orgsStore';

export const GET: RequestHandler = ({ params }) => {
  const orgId = params.orgId;
  if (!orgId) throw error(400, 'orgId required');
  const org = getOrg(orgId);
  if (!org) throw error(404, `Org ${orgId} not found`);
  return json({ org });
};
