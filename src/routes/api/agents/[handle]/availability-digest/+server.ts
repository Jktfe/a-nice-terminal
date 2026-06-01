/**
 * GET /api/agents/:handle/availability-digest[?limit=N]
 *   → 200 { digest: AvailabilityDigest }
 *   → 400 missing handle
 *   → 401 no auth
 *   → 403 caller is not the queried handle (privacy gate)
 *
 * Returns the bare-@-mention messages the handle missed during its
 * most-recent idle window (or its currently-open idle window, if the
 * terminal is still idle).
 *
 * JWPK msg_x1rkogssez 2026-05-19 — surface 'You missed N @-tags while
 * you were away' when an agent flips idle → active.
 *
 * Auth (msg_53bpcfqe9j pre-launch code review): the digest carries
 * 200-char body previews from EVERY room the handle is a member of,
 * including closed/private rooms. Read-only doesn't mean public —
 * gating: caller must be the queried handle, OR admin-bearer.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { digestForHandle } from '$lib/server/availabilityDigestStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

function canonicaliseHandle(raw: string): string {
  const withAt = raw.startsWith('@') ? raw : `@${raw}`;
  return withAt.toLowerCase();
}

export const GET: RequestHandler = ({ params, url, request }) => {
  const raw = params.handle ?? '';
  if (raw.length === 0) throw error(400, 'handle required');
  const handle = decodeURIComponent(raw);

  // Privacy gate: only the queried handle's owner OR admin-bearer can
  // read the digest. Strangers with no session get 401; sessions
  // belonging to a different handle get 403.
  const callerHandle = resolveCallerHandleAnyRoom(request);
  if (!callerHandle) {
    try {
      requireAdminAuth(request);
    } catch {
      throw error(401, 'session or admin-bearer required to read availability-digest');
    }
  } else if (canonicaliseHandle(callerHandle) !== canonicaliseHandle(handle)) {
    throw error(403, `availability-digest for ${handle} is only readable by ${handle} (or admin-bearer)`);
  }

  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const safeLimit = Number.isFinite(limit) && (limit as number) > 0
    ? Math.min(200, Math.floor(limit as number))
    : 50;
  const digest = digestForHandle({ handle, limit: safeLimit });
  return json({ digest });
};
