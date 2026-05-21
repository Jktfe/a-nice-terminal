import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPairingToken } from '$lib/server/pairingTokenStore';
import QRCode from 'qrcode';

export const GET: RequestHandler = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) throw error(400, 'token required');

  const record = getPairingToken(token);
  if (!record) throw error(404, 'Token not found');
  if (record.consumed_at_ms) throw error(410, 'Token already consumed');
  if (record.expires_at_ms && record.expires_at_ms < Date.now()) throw error(410, 'Token expired');

  // antios:// deep-link format matching v3
  const payload = `ant://connect?url=${encodeURIComponent(record.server_url)}&key=${encodeURIComponent(record.api_key)}&room=${encodeURIComponent(record.room_id)}&token=${encodeURIComponent(token)}`;

  const svg = await QRCode.toString(payload, { type: 'svg', margin: 2, width: 256 });

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'no-store',
    },
  });
};
