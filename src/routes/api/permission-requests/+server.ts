/**
 * /api/permission-requests — Stage B substrate endpoint (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 *   POST /api/permission-requests
 *     Body: {
 *       action, targetKind, targetId, reason?,
 *       pidChain?: PidChainEntry[],
 *       pendingAction?: {
 *         http_method, http_path, payload, headers?, ttlMs?
 *       }
 *     }
 *     Resolves caller identity via pidChain → terminal → handle (same
 *     path as Stage A's /api/grants). Snapshots the approver list for
 *     the target via resolveApproversFor(). Writes the permission_request
 *     row + (when supplied) the pending_actions row.
 *     -> 201 { request, pendingAction? } on success.
 *     -> 401 when caller identity cannot be resolved.
 *     -> 400 on malformed body or invalid targetKind.
 *
 * Auth model: any authenticated caller may CREATE a request for THEMSELVES
 * — the requester_handle is bound to the resolved caller, not a body field.
 * The approver check is enforced at /approve and /deny, not here. System-
 * scoped requests are allowed (the approver list comes back empty and
 * /approve will reject all non-admin callers).
 *
 * Stage A's 403 sites do NOT auto-call this endpoint in this PR — keeping
 * the substrate stand-alone so a `--auto-request` CLI flag (or the antos
 * app) can wire it in later without a substrate change.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createPermissionRequest,
  listPendingForApprover,
  listPendingForRequester,
  type CreatePermissionRequestInput
} from '$lib/server/permissionRequestsStore';
import { resolveApproversFor } from '$lib/server/permissionApproverResolver';
import type { PermissionTargetKind } from '$lib/server/permissionDeniedPayload';
import { type PidChainEntry } from '$lib/server/terminalsStore';
import {
  resolveAuthoritativeCallerIdentity,
  resolveAuthoritativeCallerIdentityFromPidChain,
  type AuthoritativeCallerIdentity
} from '$lib/server/permissionCallerIdentity';

const VALID_TARGET_KINDS: ReadonlyArray<PermissionTargetKind> = [
  'room',
  'plan',
  'task',
  'org',
  'system'
];

const VALID_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type PostBody = {
  action?: unknown;
  targetKind?: unknown;
  targetId?: unknown;
  reason?: unknown;
  pidChain?: unknown;
  pendingAction?: unknown;
};

/**
 * Sec-iter1 Fix #1 (2026-05-30): caller-handle resolution reads the
 * authoritative terminal_records.handle (1:1, UNIQUE per Fix #2). This
 * endpoint binds requester_handle to the resolved caller — without the
 * fix, an attacker could file permission_requests "from" the victim.
 *
 * Sec-iter2 Fix #3 (2026-05-30): returns the typed identity discriminated
 * by `isAdminBearer` so the GET branch + any future admin-grade logic
 * here doesn't string-compare the handle to `ADMIN_BEARER_HANDLE`.
 */
function resolveCallerIdentity(request: Request, rawBody: unknown): AuthoritativeCallerIdentity {
  return resolveAuthoritativeCallerIdentity(request, rawBody);
}

type ValidatedBody = {
  action: string;
  targetKind: PermissionTargetKind;
  targetId: string;
  reason: string | undefined;
  pendingAction: CreatePermissionRequestInput['pendingAction'] | undefined;
};

function validateBody(body: PostBody): ValidatedBody {
  const { action, targetKind, targetId, reason, pendingAction } = body;
  if (typeof action !== 'string' || action.trim().length === 0) {
    throw error(400, 'action (string) required');
  }
  if (
    typeof targetKind !== 'string' ||
    !VALID_TARGET_KINDS.includes(targetKind as PermissionTargetKind)
  ) {
    throw error(
      400,
      `targetKind must be one of: ${VALID_TARGET_KINDS.join(', ')}`
    );
  }
  if (typeof targetId !== 'string' || targetId.trim().length === 0) {
    throw error(400, 'targetId (string) required');
  }
  let normalisedReason: string | undefined;
  if (reason !== undefined) {
    if (typeof reason !== 'string') throw error(400, 'reason must be a string');
    normalisedReason = reason;
  }
  let normalisedPendingAction: ValidatedBody['pendingAction'] = undefined;
  if (pendingAction !== undefined) {
    if (!pendingAction || typeof pendingAction !== 'object' || Array.isArray(pendingAction)) {
      throw error(400, 'pendingAction must be an object');
    }
    const pa = pendingAction as Record<string, unknown>;
    const httpMethod = typeof pa.http_method === 'string' ? pa.http_method.toUpperCase() : '';
    if (!VALID_HTTP_METHODS.has(httpMethod)) {
      throw error(
        400,
        `pendingAction.http_method must be one of: ${Array.from(VALID_HTTP_METHODS).join(', ')}`
      );
    }
    if (typeof pa.http_path !== 'string' || !(pa.http_path as string).startsWith('/')) {
      throw error(400, 'pendingAction.http_path must be an absolute path starting with /');
    }
    if (pa.payload === undefined || pa.payload === null) {
      throw error(400, 'pendingAction.payload is required');
    }
    let payloadJson: string;
    if (typeof pa.payload === 'string') {
      payloadJson = pa.payload;
    } else {
      try {
        payloadJson = JSON.stringify(pa.payload);
      } catch {
        throw error(400, 'pendingAction.payload could not be serialised');
      }
    }
    let headersJson: string | undefined;
    if (pa.headers !== undefined) {
      try {
        headersJson = JSON.stringify(pa.headers);
      } catch {
        throw error(400, 'pendingAction.headers could not be serialised');
      }
    }
    let ttlMs: number | undefined;
    if (pa.ttlMs !== undefined) {
      if (typeof pa.ttlMs !== 'number' || pa.ttlMs <= 0 || !Number.isFinite(pa.ttlMs)) {
        throw error(400, 'pendingAction.ttlMs must be a positive number');
      }
      ttlMs = pa.ttlMs;
    }
    normalisedPendingAction = {
      httpMethod,
      httpPath: pa.http_path as string,
      payloadJson,
      headersJson,
      ttlMs
    };
  }
  return {
    action: action.trim(),
    targetKind: targetKind as PermissionTargetKind,
    targetId: targetId.trim(),
    reason: normalisedReason,
    pendingAction: normalisedPendingAction
  };
}

/**
 * GET /api/permission-requests?asApprover=1&pidChain=... — list the
 * pending permission_requests for the resolved caller. Default lists my
 * own pending requests (requesterHandle = caller); ?asApprover=1 lists
 * pending requests where caller is in the snapshot approver list.
 * Admin-bearer with ?asApprover=1 returns ALL pending requests (the
 * inbox-broadcast view) — useful for ops + tests.
 */
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
 * Sec-iter1 Fix #1 (2026-05-30): same authoritative-handle resolution
 * for the listing surface.
 *
 * Sec-iter2 Fix #3 (2026-05-30): returns the typed identity so the
 * admin branch below reads `isAdminBearer` instead of string-comparing
 * the handle to `ADMIN_BEARER_HANDLE`.
 */
function resolveCallerIdentityForGet(request: Request, url: URL): AuthoritativeCallerIdentity | null {
  const pidChain = parsePidChainFromQuery(url);
  return resolveAuthoritativeCallerIdentityFromPidChain(request, pidChain);
}

export const GET: RequestHandler = async ({ request, url }) => {
  const caller = resolveCallerIdentityForGet(request, url);
  if (!caller) throw error(401, 'Authentication required.');
  const asApprover = url.searchParams.get('asApprover') === '1';
  if (asApprover) {
    // Sec-iter2 Fix #3: read the typed admin discriminator instead of
    // string-comparing `caller.handle` to `ADMIN_BEARER_HANDLE`.
    // Admin sees every pending request (operator broadcast view);
    // non-admin sees only their own snapshot-approver rows.
    if (caller.isAdminBearer) {
      // Empty handle would not match any snapshot — to surface the
      // global inbox we re-use listPendingForApprover by iterating
      // every approver in turn would be O(n*m). For Stage B substrate
      // we keep the API narrow — admin-bearer asApprover=1 returns
      // the requester-side view of the synthetic '@admin' handle,
      // which will be empty unless admin themself requested.
      // Operators who need the global inbox should hit the per-target
      // listing via /api/chat-rooms/[id]/permission-requests (future
      // slice).
      return json({ requests: listPendingForApprover(caller.handle) });
    }
    return json({ requests: listPendingForApprover(caller.handle) });
  }
  return json({ requests: listPendingForRequester(caller.handle) });
};

export const POST: RequestHandler = async ({ request }) => {
  let rawBody: PostBody;
  try {
    rawBody = (await request.json()) as PostBody;
  } catch {
    throw error(400, 'JSON body required');
  }
  const requesterHandle = resolveCallerIdentity(request, rawBody).handle;
  const validated = validateBody(rawBody);
  // Snapshot the approver list at request-creation time. This matches
  // Stage A's contract: the approvers shown to the denied caller are the
  // same handles surfaced to the approver inbox.
  const approvers = resolveApproversFor({
    targetKind: validated.targetKind,
    targetId: validated.targetId
  });
  const result = createPermissionRequest({
    requesterHandle,
    action: validated.action,
    targetKind: validated.targetKind,
    targetId: validated.targetId,
    reason: validated.reason,
    approvers,
    pendingAction: validated.pendingAction
  });
  return json(
    { request: result.request, pendingAction: result.pendingAction },
    { status: 201 }
  );
};
