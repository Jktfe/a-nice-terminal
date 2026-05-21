import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';

export const GET: RequestHandler = ({ request }) => {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) throw error(401, 'bearer token required');

  const session = resolveToken(token);
  if (!session) throw error(401, 'invalid or expired token');

  return json({
    user: userShapeForEmail(session.email),
    expiresAt: session.expiresAtMs
  });
};
