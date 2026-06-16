/**
 * GET /api/helper/leases[?handle=@x] — operator-gated list of ACTIVE
 * attachments (the helper UI's "Your paired apps" + revoke surface). Returns
 * metadata only — secrets are hashed at rest and never leave the mint/redeem
 * responses.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession, tryAntchatOperatorBearer } from '$lib/server/chatRoomAuthGate';
import { listActiveLeases, listActiveLeasesForHandle } from '$lib/server/helperLeaseStore';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request) && !tryAntchatOperatorBearer(request)) {
    throw error(401, 'operator login required');
  }
  const handle = url.searchParams.get('handle');
  const leases = handle && handle.trim().length > 0
    ? listActiveLeasesForHandle(handle.trim())
    : listActiveLeases();
  return json({
    leases: leases.map((lease) => ({
      id: lease.id,
      handle: lease.handle,
      role: lease.role,
      owners: lease.owners,
      pairedHost: lease.paired_host,
      createdBy: lease.created_by,
      createdAtMs: lease.created_at_ms,
      expiresAtMs: lease.expires_at_ms,
      lastSeenAtMs: lease.last_seen_at_ms
    }))
  });
};
