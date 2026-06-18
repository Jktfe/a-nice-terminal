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
import { listLiveColonyHandles } from '$lib/server/liveColonyHandles';

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
  // The operator owns their own colony, so any LIVE colony handle is pairable
  // (JWPK 2026-06-13, correcting the over-built invite/owners model that 403'd
  // a handle that was in the dropdown). The authority is the operator browser
  // session, already verified above. We still refuse a handle that isn't a live
  // colony handle — that's the SAME list the dropdown shows, so the dropdown and
  // the gate can never disagree.
  const liveHandles = await listLiveColonyHandles();
  if (!liveHandles.includes(handle)) {
    throw error(403, `${handle} is not a live handle in this colony — only live sessions on the terminals page can be paired.`);
  }
  const extraOwners = Array.isArray(body.owners)
    ? body.owners.filter((o): o is string => typeof o === 'string')
    : [];
  // The operator is always an owner; dedupe with any extras passed.
  const owners = Array.from(new Set([operator, ...extraOwners].map((o) => o.trim()).filter((o) => o.length > 0)));

  const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) && body.ttlMs > 0 ? body.ttlMs : undefined;

  // READ-ONLY ONLY (JWPK 2026-06-13): the "pair an app" panel mints read-only
  // helpers — a lease-holder is never a member, so it must NEVER author room
  // messages. The authoring 'agent' role is refused here; authoring credentials,
  // if ever issued, go through a separate witnessed path, not this panel.
  if (body.role !== undefined && body.role !== 'reader') {
    throw error(400, "this panel only pairs read-only helpers — a paired app can never author messages.");
  }
  const role: 'reader' = 'reader';

  const res = createPairingCode({ handle, role, owners, createdBy: operator, ttlMs });
  return json({ pairingId: res.pairingId, code: res.code, expiresAtMs: res.expiresAtMs, handle, role }, { status: 201 });
};
