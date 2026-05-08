import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { assertCanWrite } from '$lib/server/room-scope';
import { listSiteTunnels, registerSiteTunnel } from '$lib/server/tunnels';
import { requireTunnelCaller } from '$lib/server/tunnel-auth';

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function GET(event: RequestEvent) {
  const caller = requireTunnelCaller(event);
  const tunnels = listSiteTunnels().filter((tunnel) =>
    caller.admin || tunnel.allowed_room_ids.includes(caller.scope.roomId)
  );
  return json({ ok: true, tunnels });
}

export async function POST(event: RequestEvent) {
  const caller = requireTunnelCaller(event);
  if (!caller.admin) assertCanWrite(event);

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  const publicUrl = typeof body.public_url === 'string' ? body.public_url : typeof body.public === 'string' ? body.public : '';
  if (!slug) throw error(400, 'slug required');
  if (!publicUrl) throw error(400, 'public_url required');

  const requestedRooms = stringArray(body.allowed_room_ids ?? body.rooms);
  const owner = caller.admin
    ? (typeof body.owner_session_id === 'string' ? body.owner_session_id : requestedRooms[0] ?? '')
    : caller.scope.roomId;
  if (!owner) throw error(400, 'owner_session_id required');
  const allowedRooms = caller.admin
    ? requestedRooms
    : Array.from(new Set([caller.scope.roomId, ...requestedRooms]));

  try {
    const tunnel = registerSiteTunnel({
      slug,
      title: typeof body.title === 'string' ? body.title : null,
      public_url: publicUrl,
      local_url: typeof body.local_url === 'string' ? body.local_url : typeof body.local === 'string' ? body.local : null,
      owner_session_id: owner,
      allowed_room_ids: allowedRooms,
      status: typeof body.status === 'string' ? body.status : 'linked',
      access_required: body.access_required === true || body.access_required === 1 || body.access_required === 'true',
    });
    return json({ ok: true, tunnel }, { status: 201 });
  } catch (err) {
    throw error(400, (err as Error).message || 'Invalid tunnel');
  }
}
