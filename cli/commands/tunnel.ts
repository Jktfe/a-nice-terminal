import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

function firstRoomId(value: unknown): string {
  if (Array.isArray(value)) return value.find((item) => typeof item === 'string' && item.trim()) || '';
  return String(value || '').split(',').map((item) => item.trim()).find(Boolean) || '';
}

function primaryRoomId(flags: any): string {
  return String(flags.session || flags.room || flags.session_id || firstRoomId(flags.rooms || flags.allowed_rooms || flags.allowed_room_ids) || '');
}

function roomOpts(flags: any): { roomToken?: string } | undefined {
  const roomId = primaryRoomId(flags);
  if (!roomId) return undefined;
  const token = config.getRoomToken(String(roomId));
  return token?.token ? { roomToken: token.token } : undefined;
}

function roomList(flags: any): string[] {
  const raw = flags.rooms || flags.allowed_rooms || flags.allowed_room_ids || flags.session || flags.room || flags.session_id || '';
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean);
}

function printTunnelRow(tunnel: any) {
  const rooms = Array.isArray(tunnel.allowed_room_ids) ? tunnel.allowed_room_ids.length : 0;
  const lock = tunnel.access_required ? ' access' : '';
  console.log(`${String(tunnel.slug).padEnd(28)} ${String(tunnel.status || 'linked').padEnd(8)} rooms=${rooms}${lock} ${tunnel.public_url}`);
}

async function listTunnels(flags: any, ctx: any) {
  const data = await api.get(ctx, '/api/tunnels', roomOpts(flags));
  const tunnels = data.tunnels || [];
  if (ctx.json) {
    console.log(JSON.stringify(tunnels, null, 2));
    return;
  }
  if (!tunnels.length) {
    console.log('No tunnels.');
    return;
  }
  for (const tunnel of tunnels) printTunnelRow(tunnel);
}

async function addTunnel(slug: string, flags: any, ctx: any) {
  if (!slug) {
    throw new Error('Usage: ant tunnel add <slug> --public https://x.trycloudflare.com [--local http://localhost:3000] [--rooms room-id]');
  }
  const publicUrl = flags.public || flags.public_url || flags.url;
  if (!publicUrl) throw new Error('Missing --public URL');
  const body = {
    slug,
    title: flags.title || undefined,
    public_url: String(publicUrl),
    local_url: flags.local || flags.local_url || undefined,
    allowed_room_ids: roomList(flags),
    owner_session_id: flags.owner || flags.owner_session_id || undefined,
    status: flags.status || 'linked',
    access_required: Boolean(flags.access_required || flags.access || flags.cloudflare_access),
  };
  const data = await api.post(ctx, '/api/tunnels', body, roomOpts(flags));
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printTunnelRow(data.tunnel);
}

async function showTunnel(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant tunnel status <slug> [--session <room-id>]');
  const data = await api.get(ctx, `/api/tunnels/${encodeURIComponent(slug)}`, roomOpts(flags));
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const tunnel = data.tunnel;
  printTunnelRow(tunnel);
  console.log(`Title:     ${tunnel.title}`);
  console.log(`Public:    ${tunnel.public_url}`);
  if (tunnel.local_url) console.log(`Local:     ${tunnel.local_url}`);
  console.log(`Owner:     ${tunnel.owner_session_id}`);
  console.log(`Rooms:     ${(tunnel.allowed_room_ids || []).join(', ') || '(none)'}`);
  if (tunnel.access_required) console.log('Access:    Cloudflare Access expected');
}

async function removeTunnel(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant tunnel remove <slug> [--session <room-id>]');
  const data = await api.del(ctx, `/api/tunnels/${encodeURIComponent(slug)}`, roomOpts(flags));
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(`Removed tunnel ${data.slug || slug}`);
}

export async function tunnel(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    await listTunnels(flags, ctx);
    return;
  }

  if (sub === 'add' || sub === 'register') {
    await addTunnel(args[1], flags, ctx);
    return;
  }

  if (sub === 'status' || sub === 'show') {
    await showTunnel(args[1], flags, ctx);
    return;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
    await removeTunnel(args[1], flags, ctx);
    return;
  }

  await showTunnel(sub, flags, ctx);
}
