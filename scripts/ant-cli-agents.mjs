/**
 * ant agents — v3-parity agents registry.
 *
 *   ant agents list [--room ROOM_ID] [--json]
 *   ant agents show <handle> [--json]
 *   ant agents set <handle> --room ROOM_ID --color HEX --icon EMOJI --bg-style card|tint|transparent [--json]
 */

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleAgentsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (action === 'list' || action === 'ls') {
    return listAgents(flags, runtime, CliInputError);
  }
  if (action === 'show' || action === 'get') {
    const handle = args[0] || flags.handle;
    return showAgent(handle, flags, runtime, CliInputError);
  }
  if (action === 'set' || action === 'update') {
    const handle = args[0] || flags.handle;
    return setAgent(handle, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  writeUsage(runtime);
  throw new CliInputError(`unknown agents verb: ${action}`);
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
  runtime.writeOut('ant agents <list|show|set> [flags]');
  runtime.writeOut('  list [--room ROOM_ID] [--json]');
  runtime.writeOut('  show <handle> [--json]');
  runtime.writeOut('  set <handle> --color HEX --icon EMOJI --bg-style card|tint|transparent [--json]');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function listAgents(flags, runtime, CliInputError) {
  const roomId = flags.room;
  const url = roomId
    ? `/api/agents?roomId=${encodeURIComponent(roomId)}`
    : '/api/agents';
  const data = await fetchJson(runtime, url);
  const agents = data.agents || [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(agents, null, 2));
    return 0;
  }
  if (!agents.length) {
    runtime.writeOut('No agents.');
    return 0;
  }
  for (const a of agents) {
    const rooms = Array.isArray(a.rooms) ? a.rooms.length : 0;
    runtime.writeOut(`${String(a.handle).padEnd(24)} ${String(a.displayName || '').padEnd(20)} rooms=${rooms}`);
  }
  return 0;
}

async function showAgent(handle, flags, runtime, CliInputError) {
  if (!handle) throw new CliInputError('show requires a handle');
  const data = await fetchJson(runtime, `/api/agents/${encodeURIComponent(handle)}`);
  const a = data.agent;
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(a, null, 2));
    return 0;
  }
  runtime.writeOut(`Handle:    ${a.handle}`);
  runtime.writeOut(`Name:      ${a.displayName || '(none)'}`);
  if (a.displayColor) runtime.writeOut(`Color:     ${a.displayColor}`);
  if (a.displayIcon) runtime.writeOut(`Icon:      ${a.displayIcon}`);
  if (a.displayBackgroundStyle) runtime.writeOut(`BgStyle:   ${a.displayBackgroundStyle}`);
  if (Array.isArray(a.rooms) && a.rooms.length) {
    runtime.writeOut('Rooms:');
    for (const r of a.rooms) {
      runtime.writeOut(`  ${r.roomId}  ${r.roomName || ''}  joined ${r.joinedAt}`);
    }
  }
  return 0;
}

async function setAgent(handle, flags, runtime, CliInputError) {
  if (!handle) throw new CliInputError('set requires a handle');

  const patch = {};
  if (flags.color !== undefined) patch.displayColor = flags.color;
  if (flags.icon !== undefined) patch.displayIcon = flags.icon;
  if (flags['bg-style'] !== undefined) patch.displayBackgroundStyle = flags['bg-style'];
  if (flags.name !== undefined) patch.displayName = flags.name;

  if (Object.keys(patch).length === 0) {
    throw new CliInputError('set requires at least one of --color, --icon, --bg-style, --name');
  }

  const data = await fetchJson(runtime, `/api/agents/${encodeURIComponent(handle)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data.agent, null, 2));
  } else {
    runtime.writeOut(`Updated ${handle}.`);
  }
  return 0;
}
