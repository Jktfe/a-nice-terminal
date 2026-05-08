import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertCanWrite } from '$lib/server/room-scope';
import { readSiteTunnelMeta, registerSiteTunnel } from '$lib/server/tunnels';
import { assertTunnelAccess, requireTunnelCaller } from '$lib/server/tunnel-auth';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function assertOwner(event: RequestEvent, ownerSessionId: string): void {
  const caller = requireTunnelCaller(event);
  if (caller.admin) return;
  assertCanWrite(event);
  if (caller.scope.roomId !== ownerSessionId) {
    throw error(403, 'Only the tunnel owner room can update this tunnel');
  }
}

export function GET(event: RequestEvent) {
  requireTunnelCaller(event);
  const tunnel = readSiteTunnelMeta(slugParam(event));
  if (!tunnel) throw error(404, 'tunnel not found');
  assertTunnelAccess(event, tunnel);
  return json({ ok: true, tunnel });
}

export async function PATCH(event: RequestEvent) {
  const existing = readSiteTunnelMeta(slugParam(event));
  if (!existing) throw error(404, 'tunnel not found');
  assertOwner(event, existing.owner_session_id);

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  try {
    const tunnel = registerSiteTunnel({
      slug: existing.slug,
      title: typeof body.title === 'string' ? body.title : existing.title,
      public_url: typeof body.public_url === 'string' ? body.public_url : typeof body.public === 'string' ? body.public : existing.public_url,
      local_url: body.local_url === null || body.local === null
        ? null
        : typeof body.local_url === 'string'
          ? body.local_url
          : typeof body.local === 'string'
            ? body.local
            : existing.local_url,
      owner_session_id: existing.owner_session_id,
      allowed_room_ids: body.allowed_room_ids !== undefined || body.rooms !== undefined
        ? stringArray(body.allowed_room_ids ?? body.rooms)
        : existing.allowed_room_ids,
      status: typeof body.status === 'string' ? body.status : existing.status,
      access_required: body.access_required === undefined ? existing.access_required : body.access_required === true || body.access_required === 1 || body.access_required === 'true',
    });
    return json({ ok: true, tunnel });
  } catch (err) {
    throw error(400, (err as Error).message || 'Invalid tunnel');
  }
}

export function DELETE(event: RequestEvent) {
  const existing = readSiteTunnelMeta(slugParam(event));
  if (!existing) throw error(404, 'tunnel not found');
  assertOwner(event, existing.owner_session_id);
  queries.deleteSiteTunnel(existing.slug);
  return json({ ok: true, slug: existing.slug });
}
