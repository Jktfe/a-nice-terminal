/**
 * POST /api/helper/pairing — operator mints a pairing code for a handle
 * (antAppHelper SPEC §3). Operator-gated: the operator login is the security
 * anchor, so a leaked code / stolen app is worthless without it.
 *
 * Body: { handle: "@desktopApp", owners?: ["@someone"], ttlMs?: number }
 *   → 201 { pairingId, code, expiresAtMs, handle }   (code shown in ANT)
 *
 * The signing operator is always recorded as an owner (>=1-human-owner). The
 * handle being paired is validated/canonicalised and may NOT be the reserved
 * operator handle (you can't pair AS the operator).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tryAdminBearer, tryOperatorSession, tryAntchatOperatorBearer } from '$lib/server/chatRoomAuthGate';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { createPairingCode } from '$lib/server/helperPairingStore';
import { getHandleRow } from '$lib/server/handleBindingsStore';

type Body = { handle?: unknown; role?: unknown; owners?: unknown; ttlMs?: unknown };

export const POST: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request) && !tryOperatorSession(request) && !tryAntchatOperatorBearer(request)) {
    throw error(401, 'operator login required to mint a pairing code');
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required with { handle }.');

  const handleRaw = body.handle;
  if (typeof handleRaw !== 'string' || handleRaw.trim().length === 0) throw error(400, 'handle is required.');
  const validation = validateHandleForRegistration(handleRaw);
  if (!validation.ok) throw error(400, validation.message);
  const handle = validation.canonicalHandle;

  const operator = getOperatorHandle();
  // OWNED-HANDLES-ONLY (JWPK + fClaude 2026-06-12, "security and all that"): a
  // SERVER rule, not just a dropdown filter — refuse minting an attachment for a
  // handle the operator doesn't own. The dropdown showing only your handles is
  // convenience; this refusal is the security. Also closes the old hole where
  // minting silently stamped the caller as owner of ANY handle they named.
  const handleOwners = (getHandleRow(handle)?.owners ?? []).map((o) => o.trim());
  if (!handleOwners.includes(operator)) {
    throw error(403, `${operator} is not an owner of ${handle} — you can only pair a handle you own.`);
  }
  const extraOwners = Array.isArray(body.owners)
    ? body.owners.filter((o): o is string => typeof o === 'string')
    : [];
  // The operator is always an owner; dedupe with any extras passed.
  const owners = Array.from(new Set([operator, ...extraOwners].map((o) => o.trim()).filter((o) => o.length > 0)));

  const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) && body.ttlMs > 0 ? body.ttlMs : undefined;

  // 'reader' pairs the read-only helper; 'agent' pairs a status attachment.
  // Neither role can write room timeline messages.
  if (body.role !== undefined && body.role !== 'reader' && body.role !== 'agent') {
    throw error(400, "role must be 'reader' or 'agent'.");
  }
  const role: 'reader' | 'agent' = body.role === 'agent' ? 'agent' : 'reader';

  const res = createPairingCode({ handle, role, owners, createdBy: operator, ttlMs });
  return json({ pairingId: res.pairingId, code: res.code, expiresAtMs: res.expiresAtMs, handle, role }, { status: 201 });
};
