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
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { lookupTerminalByPidChain, type PidChainEntry } from '$lib/server/terminalsStore';
import { listMembershipsForTerminal } from '$lib/server/roomMembershipsStore';

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

function resolveCallerHandle(request: Request, url: URL): string | null {
  if (tryAdminBearer(request)) return ADMIN_BEARER_HANDLE;
  const pidChain = parsePidChainFromQuery(url);
  if (pidChain.length === 0) return null;
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  const memberships = listMembershipsForTerminal(terminal.id);
  if (memberships.length > 0) return memberships[0].handle;
  return `@${terminal.name}`;
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
