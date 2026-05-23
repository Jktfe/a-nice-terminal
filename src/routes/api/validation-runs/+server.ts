import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValidationRunsForClaim } from '$lib/server/validationLensStore';

export const GET: RequestHandler = async ({ url }) => {
  const claimAnchor = url.searchParams.get('claimAnchor');
  if (!claimAnchor) return json({ runs: [] });
  const runs = listValidationRunsForClaim(claimAnchor);
  return json({ runs });
};
