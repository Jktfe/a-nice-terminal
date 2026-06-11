/**
 * POST /api/helper/leases/[leaseId]/revoke — operator-gated revoke. One row,
 * instant deafness: the very next use of the attachment's secret is refused.
 * 404 when the lease is unknown or already revoked (idempotent-safe surface).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession } from '$lib/server/chatRoomAuthGate';
import { revokeLease } from '$lib/server/helperLeaseStore';

export const POST: RequestHandler = async ({ request, params }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request)) {
    throw error(401, 'operator login required');
  }
  const leaseId = params.leaseId ?? '';
  if (leaseId.length === 0) throw error(400, 'leaseId required.');
  const revoked = revokeLease(leaseId);
  if (!revoked) throw error(404, 'no live lease with that id.');
  return json({ revoked: true });
};
