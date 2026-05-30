/**
 * GET /api/permission-requests/:requestId — Stage B substrate poller surface
 * (plan milestone p3-stage-b-permission-requests of
 * ant-substrate-v0.2-2026-05-29).
 *
 * The original CLI caller polls this to learn whether their request has
 * been approved. When the pending_action's replay_status flips to
 * 'ready_for_replay' the CLI re-runs the original action and POSTs to
 * /replayed-by-caller to close the loop.
 *
 * Auth: requester OR an approver OR admin-bearer may read. Other handles
 * 403 to keep request bodies (which may carry sensitive payloads) private
 * to the parties involved.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getPendingActionForRequest,
  getPermissionRequest
} from '$lib/server/permissionRequestsStore';
import { ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { type PidChainEntry } from '$lib/server/terminalsStore';
import { resolveAuthoritativeCallerHandleFromPidChain } from '$lib/server/permissionCallerIdentity';

function parsePidChainFromQuery(url: URL): PidChainEntry[] {
  const raw = url.searchParams.get('pidChain');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PidChainEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { pid?: unknown }).pid === 'number'
    );
  } catch {
    return [];
  }
}

/**
 * Sec-iter1 Fix #1 (2026-05-30 enterprise security pass): same fix as
 * the approve/deny gates — read terminal_records.handle as the
 * authoritative caller identity. Without this fix, the auth check
 * below ("isRequester || isApprover || isAdmin") would accept any
 * caller whose per-room membership row used the victim's handle.
 */
function resolveCallerHandle(request: Request, url: URL): string | null {
  const pidChain = parsePidChainFromQuery(url);
  return resolveAuthoritativeCallerHandleFromPidChain(request, pidChain);
}

export const GET: RequestHandler = async ({ request, params, url }) => {
  const requestId = params.requestId;
  if (!requestId || typeof requestId !== 'string') {
    throw error(400, 'requestId required in path');
  }
  const callerHandle = resolveCallerHandle(request, url);
  if (!callerHandle) throw error(401, 'Authentication required.');

  const record = getPermissionRequest(requestId);
  if (!record) throw error(404, 'permission_request not found');

  // Allow: admin-bearer / requester / approver-snapshot member.
  const isRequester = record.requesterHandle === callerHandle;
  const isApprover = record.approverHandles.some((a) => a.handle === callerHandle);
  const isAdmin = callerHandle === ADMIN_BEARER_HANDLE;
  if (!isRequester && !isApprover && !isAdmin) {
    throw error(403, 'Not a party to this permission_request.');
  }

  const pendingAction = record.pendingActionId
    ? getPendingActionForRequest(requestId)
    : null;
  return json({ request: record, pendingAction });
};
