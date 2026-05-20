/**
 * POST /api/license/refresh
 *
 * Re-fetch the caller's current licence shape using their antchat Bearer
 * token (no body required). The Mac client polls this so a tier change
 * (e.g. dev → paid → free) propagates without forcing the user to sign
 * out + log back in.
 *
 * Request:  Authorization: Bearer <antchat-login-token>  (no body)
 * Response (200): LicenceValidationResponse — same shape as
 *                 POST /api/license/validate.
 * Response (401): missing/invalid bearer.
 *
 * Drift cleared: @evolveanttauri msg_aynmh2zcs8 §D3
 * (`/api/license/refresh 404` — Swift client was either hiding the
 * affordance or 401-burning a timer). Mirrors /api/license/validate.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken,
  licenceShapeForEmail
} from '$lib/server/antchatAuthStore';

export const POST: RequestHandler = async ({ request }) => {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) throw error(401, 'antchat bearer token required');
  const session = resolveToken(token);
  if (!session) throw error(401, 'antchat bearer token invalid or expired');
  return json(licenceShapeForEmail(session.email));
};
