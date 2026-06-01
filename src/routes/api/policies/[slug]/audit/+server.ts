/**
 * GET /api/policies/[slug]/audit — append-only audit log for a policy.
 *
 * Visibility follows the parent policy: if the caller can read the
 * policy, they can read its audit. Private policies are owner-only.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPolicyBySlug, listAuditForPolicy } from '$lib/server/policyStore';
import { resolvePolicyActor } from '$lib/server/policyActor';

export const GET: RequestHandler = ({ params, request }) => {
  let callerHandle: string | null = null;
  try {
    callerHandle = resolvePolicyActor(request, null)?.handle ?? null;
  } catch { /* anonymous read of public audit ok */ }

  const policy = getPolicyBySlug(params.slug);
  if (!policy) throw error(404, 'Policy not found.');
  if (policy.deletedAtMs !== null && policy.ownerHandle !== callerHandle) {
    throw error(404, 'Policy not found.');
  }
  if (policy.visibility === 'private' && policy.ownerHandle !== callerHandle) {
    throw error(403, 'Policy is private.');
  }

  const audit = listAuditForPolicy(policy.id);
  return json({ audit });
};
