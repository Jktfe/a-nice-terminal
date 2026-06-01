/**
 * ant tunnel — v3-parity local-dev site sharing.
 *
 *   ant tunnel list --room ROOM_ID [--json]
 *   ant tunnel add <slug> --public URL [--local URL] [--title TEXT] [--rooms room-id,...] [--access-required] [--json]
 *   ant tunnel status <slug> [--json]
 *   ant tunnel remove <slug> [--json]
 */

const BOOLEAN_FLAGS = new Set(['json', 'access-required']);

export async function handleTunnelVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (action === 'list' || action === 'ls') {
    return listTunnels(flags, runtime, CliInputError);
  }
  if (action === 'add' || action === 'register') {
    const slug = args[0];
    return addTunnel(slug, flags, runtime, CliInputError);
  }
  if (action === 'status' || action === 'show') {
    const slug = args[0] || flags.slug;
    return showTunnel(slug, runtime, CliInputError);
  }
  if (action === 'remove' || action === 'rm' || action === 'delete') {
    const slug = args[0] || flags.slug;
    return removeTunnel(slug, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  writeUsage(runtime);
  throw new CliInputError(`unknown tunnel verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant tunnel <list|add|status|remove> [flags]');
  runtime.writeOut('  list --room ROOM_ID [--json]');
  runtime.writeOut('  add <slug> --public URL [--local URL] [--title TEXT] [--rooms room-id,...] [--access-required] [--json]');
  runtime.writeOut('  status <slug> [--json]');
  runtime.writeOut('  remove <slug> [--json]');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function listTunnels(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('list requires --room');
  const data = await fetchJson(runtime, `/api/tunnels?roomId=${encodeURIComponent(roomId)}`);
  const tunnels = data.tunnels || [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(tunnels, null, 2));
    return 0;
  }
  if (!tunnels.length) {
    runtime.writeOut('No tunnels.');
    return 0;
  }
  for (const t of tunnels) {
    const rooms = Array.isArray(t.allowed_room_ids) ? t.allowed_room_ids.length : 0;
    const lock = t.access_required ? ' access' : '';
    runtime.writeOut(`${String(t.slug).padEnd(28)} ${String(t.status || 'linked').padEnd(8)} rooms=${rooms}${lock} ${t.public_url}`);
  }
  return 0;
}

async function addTunnel(slug, flags, runtime, CliInputError) {
  if (!slug) throw new CliInputError('add requires a slug positional');
  const publicUrl = flags.public || flags.public_url || flags.url;
  if (!publicUrl) throw new CliInputError('add requires --public URL');

  const body = {
    slug,
    title: flags.title || undefined,
    public_url: publicUrl,
    local_url: flags.local || flags.local_url || undefined,
    allowed_room_ids: (flags.rooms || '').split(',').map((s) => s.trim()).filter(Boolean),
    access_required: flags['access-required'] !== undefined,
  };

  const data = await fetchJson(runtime, '/api/tunnels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data.tunnel, null, 2));
  } else {
    const t = data.tunnel;
    runtime.writeOut(`Added tunnel ${t.slug}: ${t.public_url}`);
  }
  return 0;
}

async function showTunnel(slug, runtime, CliInputError) {
  if (!slug) throw new CliInputError('status requires a slug');
  const data = await fetchJson(runtime, `/api/tunnels/${encodeURIComponent(slug)}`);
  const t = data.tunnel;
  runtime.writeOut(`Slug:      ${t.slug}`);
  runtime.writeOut(`Title:     ${t.title || '(none)'}`);
  runtime.writeOut(`Public:    ${t.public_url}`);
  if (t.local_url) runtime.writeOut(`Local:     ${t.local_url}`);
  runtime.writeOut(`Owner:     ${t.owner_room_id}`);
  runtime.writeOut(`Rooms:     ${(t.allowed_room_ids || []).join(', ') || '(none)'}`);
  if (t.access_required) runtime.writeOut('Access:    required');
  return 0;
}

async function removeTunnel(slug, runtime, CliInputError) {
  if (!slug) throw new CliInputError('remove requires a slug');
  await fetchJson(runtime, `/api/tunnels/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  runtime.writeOut(`Removed tunnel ${slug}.`);
  return 0;
}
