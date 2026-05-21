/**
 * ant share — read-only public URLs for sharing room state externally.
 *
 *   ant share create --room ROOM_ID [--title TEXT] [--scope room|messages|tasks|plan] [--expires-hours N] [--json]
 *   ant share list --room ROOM_ID [--json]
 *   ant share revoke <token> [--json]
 *   ant share show <token> [--json]
 */

const BOOLEAN_FLAGS = new Set(['json']);
const SCOPE_VALUES = new Set(['room', 'messages', 'tasks', 'plan']);

export async function handleShareVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (action === 'create') {
    return createShare(flags, runtime, CliInputError);
  }
  if (action === 'list') {
    return listShares(flags, runtime, CliInputError);
  }
  if (action === 'revoke') {
    const token = args[0] || flags.token;
    return revokeShare(token, flags, runtime, CliInputError);
  }
  if (action === 'show') {
    const token = args[0] || flags.token;
    return showShare(token, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  writeUsage(runtime);
  throw new CliInputError(`unknown share verb: ${action}`);
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
  runtime.writeOut('ant share <create|list|revoke|show> [flags]');
  runtime.writeOut('  create --room ROOM_ID [--title TEXT] [--scope room|messages|tasks|plan] [--expires-hours N] [--json]');
  runtime.writeOut('  list --room ROOM_ID [--json]');
  runtime.writeOut('  revoke <token> [--json]');
  runtime.writeOut('  show <token> [--json]');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function createShare(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('create requires --room');

  const scope = flags.scope || 'room';
  if (!SCOPE_VALUES.has(scope)) throw new CliInputError(`scope must be one of: ${[...SCOPE_VALUES].join(', ')}`);

  const body = {
    roomId,
    title: flags.title || undefined,
    scope,
    expiresAtMs: flags['expires-hours']
      ? Date.now() + Number(flags['expires-hours']) * 60 * 60 * 1000
      : undefined,
  };

  const data = await fetchJson(runtime, '/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const link = data.link;
  const publicUrl = `${runtime.serverUrl}/api/share/${link.token}`;

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ ...link, publicUrl }, null, 2));
  } else {
    runtime.writeOut(`Created share link: ${publicUrl}`);
    runtime.writeOut(`Room: ${link.room_id}`);
    runtime.writeOut(`Scope: ${link.scope}`);
    if (link.expires_at_ms) runtime.writeOut(`Expires: ${new Date(link.expires_at_ms).toISOString()}`);
  }
  return 0;
}

async function listShares(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('list requires --room');
  const data = await fetchJson(runtime, `/api/share?roomId=${encodeURIComponent(roomId)}`);
  const links = data.links || [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(links, null, 2));
    return 0;
  }
  if (!links.length) {
    runtime.writeOut('No share links.');
    return 0;
  }
  for (const l of links) {
    const status = l.revoked_at_ms ? 'revoked' : (l.expires_at_ms && l.expires_at_ms < Date.now() ? 'expired' : 'active');
    runtime.writeOut(`${l.token.slice(0, 16)}... ${status} scope=${l.scope} room=${l.room_id} accesses=${l.access_count}`);
  }
  return 0;
}

async function revokeShare(token, flags, runtime, CliInputError) {
  if (!token) throw new CliInputError('revoke requires a token');
  await fetchJson(runtime, `/api/share/${encodeURIComponent(token)}`, { method: 'DELETE' });
  runtime.writeOut(`Revoked share link ${token.slice(0, 16)}...`);
  return 0;
}

async function showShare(token, flags, runtime, CliInputError) {
  if (!token) throw new CliInputError('show requires a token');
  const data = await fetchJson(runtime, `/api/share/${encodeURIComponent(token)}`);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data, null, 2));
  } else {
    runtime.writeOut(`Room: ${data.room?.name || data.room?.id}`);
    runtime.writeOut(`Scope: ${data.scope}`);
    runtime.writeOut(`Messages: ${Array.isArray(data.messages) ? data.messages.length : 'N/A'}`);
  }
  return 0;
}
