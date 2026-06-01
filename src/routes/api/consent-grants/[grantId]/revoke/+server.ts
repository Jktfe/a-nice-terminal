import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { revokeConsentGrant } from '$lib/server/consentGrantStore';

export const POST: RequestHandler = async ({ params, request }) => {
  requireAdminAuth(request);
  const grantId = params.grantId ?? '';
  if (grantId.length === 0) throw error(400, 'grantId required');
  const body = await request.json().catch(() => ({}));
  const revokedBy =
    body && typeof body === 'object' && !Array.isArray(body) && typeof body.revokedBy === 'string'
      ? body.revokedBy
      : null;
  const grant = revokeConsentGrant(grantId, revokedBy);
  if (!grant) throw error(404, 'grant not found');
  return json({ grant, revoked: true });
};
