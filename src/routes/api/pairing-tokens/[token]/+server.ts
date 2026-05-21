import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPairingToken, consumePairingToken } from '$lib/server/pairingTokenStore';

export const GET: RequestHandler = async ({ params }) => {
  const token = getPairingToken(params.token);
  if (!token) throw error(404, 'Token not found');
  return json({ token: {
    room_id: token.room_id,
    server_url: token.server_url,
    consumed_at_ms: token.consumed_at_ms,
    expires_at_ms: token.expires_at_ms,
  }});
};

export const POST: RequestHandler = async ({ params, request }) => {
  const token = getPairingToken(params.token);
  if (!token) throw error(404, 'Token not found');
  if (token.consumed_at_ms) throw error(410, 'Token already consumed');
  if (token.expires_at_ms && token.expires_at_ms < Date.now()) throw error(410, 'Token expired');

  const body = await request.json().catch(() => ({}));
  const consumed = consumePairingToken(params.token, body.deviceName);
  if (!consumed) throw error(410, 'Token no longer valid');

  return json({ token: {
    room_id: consumed.room_id,
    server_url: consumed.server_url,
    api_key: consumed.api_key,
    consumed_at_ms: consumed.consumed_at_ms,
  }});
};

export const DELETE: RequestHandler = async ({ params }) => {
  const token = getPairingToken(params.token);
  if (!token) throw error(404, 'Token not found');
  // TODO: check ownership before allowing delete
  return json({ success: true });
};
