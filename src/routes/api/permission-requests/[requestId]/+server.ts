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
import { type PidChainEntry } from '$lib/server/terminalsStore';
import {
  resolveAuthoritativeCallerIdentityFromPidChain,
  type AuthoritativeCallerIdentity
} from '$lib/server/permissionCallerIdentity';

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
 * Sec-iter1 Fix #1 (2026-05-30): read terminal_records.handle as the
 * authoritative caller identity.
 *
 * Sec-iter2 Fix #3 (2026-05-30): returns the typed identity. The auth
 * check below ("isRequester || isApprover || isAdmin") now reads
 * `caller.isAdminBearer` instead of string-comparing the handle to
 * `ADMIN_BEARER_HANDLE` — that string-eq was the iter2 bypass surface.
 */
function resolveCallerIdentity(request: Request, url: URL): AuthoritativeCallerIdentity | null {
  const pidChain = parsePidChainFromQuery(url);
  return resolveAuthoritativeCallerIdentityFromPidChain(request, pidChain);
}

export const GET: RequestHandler = async ({ request, params, url }) => {
  const requestId = params.requestId;
  if (!requestId || typeof requestId !== 'string') {
    throw error(400, 'requestId required in path');
  }
  const caller = resolveCallerIdentity(request, url);
  if (!caller) throw error(401, 'Authentication required.');

  const record = getPermissionRequest(requestId);
  if (!record) throw error(404, 'permission_request not found');

  // Allow: admin-bearer / requester / approver-snapshot member.
  // Sec-iter2 Fix #3: admin signal is the typed `isAdminBearer` boolean,
  // never a string-compare to the admin sentinel handle.
  const isRequester = record.requesterHandle === caller.handle;
  const isApprover = record.approverHandles.some((a) => a.handle === caller.handle);
  const isAdmin = caller.isAdminBearer;
  if (!isRequester && !isApprover && !isAdmin) {
    throw error(403, 'Not a party to this permission_request.');
  }

  const pendingAction = record.pendingActionId
    ? getPendingActionForRequest(requestId)
    : null;
  return json({ request: record, pendingAction });
};
