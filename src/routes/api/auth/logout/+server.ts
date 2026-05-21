import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bearerTokenFromHeader, revokeToken } from '$lib/server/antchatAuthStore';

export const POST: RequestHandler = ({ request }) => {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) throw error(401, 'bearer token required');

  revokeToken(token);
  return json({ ok: true });
};
