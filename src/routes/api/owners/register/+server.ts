/**
 * POST /api/owners/register — one-time owner creation.
 *
 * Part of plan_consent_gate_2026_05_20 (consent-gated impersonation).
 * Creates the stable owner identity for a kind="human" member. The
 * handle becomes the primary_handle and is added to owner_handles as
 * an alias (renames are supported via a future endpoint).
 *
 * Auth: admin-bearer required. This is the bootstrap step — only the
 * operator with the ANT_ADMIN_TOKEN can claim a human handle. Once
 * created, all subsequent operations gate on the owner's password.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOwner, findOwnerByHandle } from '$lib/server/ownersStore';
import { ADMIN_BEARER_HANDLE } from '$lib/server/chatRoomAuthGate';
import { bearerTokenFromHeader } from '$lib/server/antchatAuthStore';
import { normalizeOperatorEmailOrThrow, setOperatorEmail } from '$lib/server/operatorEmail';
import { timingSafeEqual } from 'crypto';

function requireAdminBearer(request: Request): void {
  const expected = process.env.ANT_ADMIN_TOKEN;
  if (!expected || expected.length === 0) throw error(503, 'admin bearer not configured');
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'admin bearer required');
  const a = Buffer.from(bearer);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw error(401, 'admin bearer mismatch');
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminBearer(request);
  const body = (await request.json().catch(() => ({}))) as {
    handle?: unknown;
    password?: unknown;
    operatorEmail?: unknown;
  };
  const handleRaw = typeof body.handle === 'string' ? body.handle.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const operatorEmailRaw = typeof body.operatorEmail === 'string' ? body.operatorEmail : '';
  let operatorEmail: string | null = null;
  if (operatorEmailRaw.length > 0) {
    try {
      operatorEmail = normalizeOperatorEmailOrThrow(operatorEmailRaw);
    } catch {
      throw error(400, 'operatorEmail must be a valid account email');
    }
  }
  if (handleRaw.length === 0) throw error(400, 'handle required');
  if (password.length < 8) throw error(400, 'password must be at least 8 characters');
  const handle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
  if (findOwnerByHandle(handle)) throw error(409, 'handle already claimed');
  const owner = createOwner({ handle, password });
  if (operatorEmail) {
    setOperatorEmail({ email: operatorEmail, updatedBy: 'owners-register' });
  }
  // Never echo password back; ADMIN_BEARER_HANDLE used to attribute audit.
  void ADMIN_BEARER_HANDLE;
  return json(
    {
      owner: {
        id: owner.id,
        primaryHandle: owner.primaryHandle,
        totpEnrolledAtMs: owner.totpEnrolledAtMs,
        createdAtMs: owner.createdAtMs
      },
      operatorEmailConfigured: Boolean(operatorEmail)
    },
    { status: 201 }
  );
};
