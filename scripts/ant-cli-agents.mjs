/**
 * ant agents — v3-parity agents registry + CLI-agent bring-in.
 *
 *   ant agents list [--room ROOM_ID] [--json]
 *   ant agents show <handle> [--json]
 *   ant agents set <handle> --room ROOM_ID --color HEX --icon EMOJI --bg-style card|tint|transparent [--json]
 *   ant agents status [--idle] [--in-room] [--model claude|...] [--skill stripe|...] [--room ROOM_ID] [--json]
 *   ant agents bring-in --room ROOM_ID [--cli codex|pi] [--cwd PATH] [--json]
 */

const BOOLEAN_FLAGS = new Set(['json', 'idle', 'in-room']);

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
  if (action === 'status') {
    return statusAgents(flags, runtime, CliInputError);
  }
  if (action === 'bring-in' || action === 'bringin') {
    return bringInAgent(flags, runtime, CliInputError);
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
  runtime.writeOut('ant agents <list|show|set|status> [flags]');
  runtime.writeOut('  list [--room ROOM_ID] [--json]');
  runtime.writeOut('  show <handle> [--json]');
  runtime.writeOut('  set <handle> --color HEX --icon EMOJI --bg-style card|tint|transparent [--json]');
  runtime.writeOut('  status [--idle] [--in-room] [--model claude|codex|...] [--skill stripe|...] [--room ROOM_ID] [--json]');
  runtime.writeOut('  bring-in --room ROOM_ID [--cli codex|pi] [--cwd PATH] [--json]');
}

/**
 * `ant agents bring-in --room X` — spawn a CLI-agent (codex by default)
 * and tag it for the named room. Wraps POST /api/chat-rooms/:roomId/cli-agents
 * which mints the handle + records the room association in one call.
 *
 * Closes dogfood finding #1 (2026-05-25): operators reading `ant --help`
 * had no CLI verb for "spawn a codex agent" — the affordance lived only
 * in the /cli-agents web page until PR #53 added the room-scoped endpoint.
 */
async function bringInAgent(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) {
    throw new CliInputError(
      'agents bring-in needs --room ROOM_ID\n  Usage: ant agents bring-in --room <ROOM_ID> [--cli codex|pi] [--cwd <PATH>]'
    );
  }
  const cli = flags.cli ?? 'codex';
  if (cli !== 'codex' && cli !== 'pi') {
    throw new CliInputError(`--cli must be "codex" or "pi", got "${cli}"`);
  }
  const body = { cli };
  if (flags.cwd) body.cwd = flags.cwd;
  const data = await fetchJson(
    runtime,
    `/api/chat-rooms/${encodeURIComponent(roomId)}/cli-agents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data, null, 2));
    return 0;
  }
  runtime.writeOut(`Brought in ${data.cli} as ${data.handleId} in room ${roomId}`);
  const roomUrl = `${runtime.serverUrl.replace(/\/$/, '')}/rooms/${roomId}`;
  runtime.writeOut('');
  runtime.writeOut('Next steps:');
  runtime.writeOut(`  Send a prompt:   curl -X POST ${runtime.serverUrl}/api/cli-agents/${data.handleId}/prompt -d '{"text":"..."}' -H 'content-type: application/json'`);
  runtime.writeOut(`  Open in room:    ${roomUrl}`);
  if (data.sessionId) {
    runtime.writeOut(`  View timeline:   ${runtime.serverUrl.replace(/\/$/, '')}/cli-hooks/${data.sessionId}`);
  }
  return 0;
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

async function statusAgents(flags, runtime, CliInputError) {
  // Build the query string. `--idle` and `--in-room` are mutually exclusive
  // boolean filters over the same field on the server (inRoom=false vs
  // inRoom=true), so reject the combo before the fetch.
  if (flags.idle !== undefined && flags['in-room'] !== undefined) {
    throw new CliInputError('--idle and --in-room are mutually exclusive');
  }
  const params = new URLSearchParams();
  if (flags.idle !== undefined) params.set('inRoom', 'false');
  if (flags['in-room'] !== undefined) params.set('inRoom', 'true');
  if (flags.model !== undefined) params.set('model', flags.model);
  if (flags.skill !== undefined) params.set('skill', flags.skill);
  if (flags.room !== undefined) params.set('roomId', flags.room);
  const qs = params.toString();
  const url = qs ? `/api/agents/availability?${qs}` : '/api/agents/availability';
  const data = await fetchJson(runtime, url);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data, null, 2));
    return 0;
  }

  const agents = Array.isArray(data.agents) ? data.agents : [];
  if (agents.length === 0) {
    runtime.writeOut('No agents.');
    return 0;
  }

  // Tabular print — column widths roughly match the task spec example, with
  // ellipsis truncation so an agent in 5 rooms doesn't run the line off-screen.
  runtime.writeOut(
    `${pad('HANDLE', 20)} ${pad('MODEL', 8)} ${pad('STATE', 9)} ${pad('ROOMS', 32)} TASK`
  );
  for (const a of agents) {
    const state = rolledUpState(a);
    const roomsCol = formatRooms(a.currentRooms || []);
    const taskCol = a.currentTask ? a.currentTask.id : '-';
    runtime.writeOut(
      `${pad(a.handle, 20)} ${pad(a.model || 'unknown', 8)} ${pad(state, 9)} ${pad(roomsCol, 32)} ${taskCol}`
    );
  }
  if (data.summary) {
    const s = data.summary;
    runtime.writeOut(`-- ${s.total} agents (${s.inRoom} in-room, ${s.idle} idle, ${s.focused} focused)`);
  }
  return 0;
}

function rolledUpState(agent) {
  if (!agent.alive) return 'archived';
  const rooms = Array.isArray(agent.currentRooms) ? agent.currentRooms : [];
  if (rooms.length === 0) return 'idle';
  if (rooms.some((r) => r.status === 'focused')) return 'focused';
  if (rooms.some((r) => r.status === 'active')) return 'active';
  return 'idle';
}

function formatRooms(rooms) {
  if (rooms.length === 0) return '-';
  const labels = rooms.map((r) => {
    if (r.status === 'focused') return `${r.roomId} (focused)`;
    return r.roomId;
  });
  const joined = labels.join(', ');
  if (joined.length <= 32) return joined;
  return `${joined.slice(0, 30)}, …`;
}

function pad(value, width) {
  const s = String(value ?? '');
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}
