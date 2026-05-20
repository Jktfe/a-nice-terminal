/**
 * DELETE /api/remote-invites/:token — Mac antchat shim for revoking a
 * remote-ant invite.
 *
 * The URL `:token` segment is the admission_id (`adm_...`) returned at
 * create time. We do NOT accept the plaintext invite code here — the
 * server only stores its hash, so identifying an admission by its code
 * would require a hash-comparison scan and would surface a side-channel
 * (timing) on otherwise-private codes. admission_id is opaque, server-
 * minted, and already what the list endpoint returns.
 *
 * Wraps `remoteAdmissionStore.revokeAdmission`. Idempotent at the store
 * level: revoking an already-revoked admission returns 404 (not "still
 * revoked OK") so the Mac app can detect concurrent revokes. After a
 * successful revoke a subsequent redeem returns 410, satisfying
 * acceptance gate 4.
 *
 * Auth: Mac antchat Bearer token (issued by /api/auth/login). 401 if
 * missing/unresolved.
 *
 * Response (200):
 *   { revoked: true, admission_id: string }
 *
 * Errors:
 *   400 missing token URL segment
 *   401 missing/invalid antchat Bearer
 *   404 admission not found OR already revoked
 *
 * Source directive: @evolveantswift msg_57o7qyc54b (D2 remote-invite shim).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken
} from '$lib/server/antchatAuthStore';
import { revokeAdmission } from '$lib/server/remoteAdmissionStore';

export const DELETE: RequestHandler = async ({ request, params }) => {
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'bearer token required');
  const session = resolveToken(bearer);
  if (!session) throw error(401, 'invalid or expired token');

  const admissionId = params.token ?? '';
  if (admissionId.length === 0) throw error(400, 'admission_id (URL :token) required');

  const ok = revokeAdmission(admissionId);
  if (!ok) throw error(404, 'admission not found or already revoked');

  return json({ revoked: true, admission_id: admissionId });
};
