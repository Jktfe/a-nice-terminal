import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  resolveToken,
  issueToken,
  setUserPassword,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const raw = body as Record<string, unknown>;
  const tempToken = raw.tempToken;
  const newPassword = raw.newPassword;
  if (typeof tempToken !== 'string' || tempToken.trim().length === 0) {
    throw error(400, 'tempToken required');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 4) {
    throw error(400, 'newPassword must be at least 4 characters');
  }

  const session = resolveToken(tempToken);
  if (!session) throw error(401, 'invalid or expired temp token');

  setUserPassword(session.email, newPassword);
  const { token, expiresAtMs } = issueToken(session.email);
  return json({
    token,
    user: userShapeForEmail(session.email),
    expiresAt: expiresAtMs
  });
};
