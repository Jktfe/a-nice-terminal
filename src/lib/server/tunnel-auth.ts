import { error, type RequestEvent } from '@sveltejs/kit';
import { assertCanWrite, roomScope, type RoomScope } from './room-scope.js';
import type { SiteTunnelMeta } from './tunnels.js';

function presentedMasterKey(event: RequestEvent): string | null {
  const auth = event.request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return event.request.headers.get('x-api-key') || event.url.searchParams.get('apiKey');
}

export function isTunnelAdmin(event: RequestEvent): boolean {
  return Boolean(process.env.ANT_API_KEY && presentedMasterKey(event) === process.env.ANT_API_KEY);
}

export function assertTunnelAccess(event: RequestEvent, tunnel: SiteTunnelMeta, opts: { write?: boolean } = {}): void {
  if (isTunnelAdmin(event)) return;
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Tunnel access requires a room invite token');
  if (!tunnel.allowed_room_ids.includes(scope.roomId)) {
    throw error(403, 'Room token does not authorise this tunnel');
  }
  if (opts.write) assertCanWrite(event);
}

export function requireTunnelCaller(event: RequestEvent): { admin: true; scope: null } | { admin: false; scope: RoomScope } {
  if (isTunnelAdmin(event)) return { admin: true, scope: null };
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Tunnel access requires a room invite token');
  return { admin: false, scope };
}
