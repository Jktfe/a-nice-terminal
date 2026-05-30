/**
 * /api/reclaim-requests — PR-C super-admin reclaim CLI primitive
 * (substrate v0.2 plan, 2026-05-29).
 *
 * POST  /api/reclaim-requests
 *   Body: { targetKind: 'terminal'|'membership'|'identity'|'session',
 *           targetId: string,
 *           reason: string,
 *           diagnostic?: Record<string, unknown> }
 *   Auth: admin-bearer ONLY (Stage A scope; widens when Part 4 trust_pubkey
 *         + org-admin attestation lift ships).
 *   201 → { request: ReclaimRequest }
 *
 * GET   /api/reclaim-requests
 *   Auth: admin-bearer ONLY.
 *   200 → { requests: ReclaimRequest[] }  (pending only)
 *
 * Reclaim is the destructive identity-surgery primitive that replaces
 * tonight's 4-hour raw-SQL forensic. Admin-bearer scope is deliberate
 * — the auth surface widens only when there's a second factor
 * (signature, org attestation) to bind against.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import {
  createReclaimRequest,
  listPendingReclaims,
  type ReclaimTargetKind
} from '$lib/server/reclaimRequestsStore';

const VALID_KINDS: readonly ReclaimTargetKind[] = [
  'terminal',
  'membership',
  'identity',
  'session'
];

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== 'object') {
    throw error(400, 'JSON body required.');
  }
  const targetKindRaw = body.targetKind;
  if (
    typeof targetKindRaw !== 'string' ||
    !VALID_KINDS.includes(targetKindRaw as ReclaimTargetKind)
  ) {
    throw error(
      400,
      `targetKind must be one of: ${VALID_KINDS.join(', ')}`
    );
  }
  const targetId =
    typeof body.targetId === 'string' && body.targetId.length > 0
      ? body.targetId
      : null;
  if (targetId === null) {
    throw error(400, 'targetId (non-empty string) is required.');
  }
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason
      : null;
  if (reason === null) {
    throw error(400, 'reason (non-empty string) is required.');
  }
  const requesterHandle =
    typeof body.requesterHandle === 'string' && body.requesterHandle.length > 0
      ? body.requesterHandle
      : '@admin';
  const diagnostic =
    body.diagnostic && typeof body.diagnostic === 'object'
      ? (body.diagnostic as Record<string, unknown>)
      : null;
  const created = createReclaimRequest({
    requesterHandle,
    targetKind: targetKindRaw as ReclaimTargetKind,
    targetId,
    reason,
    diagnostic
  });
  return json({ request: created }, { status: 201 });
};

export const GET: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  return json({ requests: listPendingReclaims() });
};
