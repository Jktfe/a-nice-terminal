import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';
import { handlesForEmail } from '$lib/server/chatRoomReadGate';

export const GET: RequestHandler = ({ request }) => {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) throw error(401, 'bearer token required');

  const session = resolveToken(token);
  if (!session) throw error(401, 'invalid or expired token');

  // handleFamily exposes the full alias set the server uses to gate
  // reads. SSE reducer clients (antchat / antios reactions M1) match
  // incoming `reactorHandle` deltas against this set to flip viewer-
  // owned summary fields. See eiw05zdurz 2026-05-27 msg_s21fibyq79.
  return json({
    user: {
      ...userShapeForEmail(session.email),
      handleFamily: handlesForEmail(session.email)
    },
    expiresAt: session.expiresAtMs
  });
};
