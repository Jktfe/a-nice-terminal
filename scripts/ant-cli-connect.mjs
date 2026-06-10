import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { chooseRegisterPidChain } from './ant-cli-register.mjs';
import {
  persistAntSessionBindingToConfig,
  readAntSessionBindingFromConfig
} from './ant-cli-config-write.mjs';

const PARSE_TTL_PATTERN = /^(\d+)(s|m|h)?$/;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const BOOL = new Set(['json']);

export async function handleConnectVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const fullArgs = action !== undefined && String(action).startsWith('--')
    ? [action, ...args]
    : args;
  if (action === 'help' || action === '--help') {
    writeUsage(runtime);
    return 0;
  }
  const { flags } = parseFlags(fullArgs, CliInputError);
  return runConnect(flags, runtime, CliInputError);
}

function writeUsage(runtime) {
  runtime.writeOut('ant connect --handle @h --name NAME [--pane PANE_ID] [--agent-kind claude_code] [--room ROOM_ID] [--json]');
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOL.has(name)) {
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
  return { flags };
}

function parseTtlSeconds(rawTtl) {
  if (rawTtl === undefined || rawTtl === null) return DEFAULT_TTL_SECONDS;
  const match = String(rawTtl).trim().toLowerCase().match(PARSE_TTL_PATTERN);
  if (!match) return DEFAULT_TTL_SECONDS;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  if (unit === 'h') return amount * 3600;
  if (unit === 'm') return amount * 60;
  return amount;
}

function normaliseSessionId(raw) {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function detectPane(flags, runtime) {
  return flags.pane ?? runtime.envTmuxPane ?? process.env.TMUX_PANE ?? process.env.WEZTERM_PANE ?? null;
}

function existingSessionToken(flags, runtime, context) {
  const explicit = normaliseSessionId(flags['session-id']);
  if (explicit) return { token: explicit, source: 'flag' };
  const env = normaliseSessionId(process.env.ANT_SESSION_ID);
  if (env) return { token: env, source: 'env' };
  const config = readAntSessionBindingFromConfig({
    pane: context.pane,
    terminalName: context.name,
    homeDir: runtime.homeDir
  });
  return config ? { token: config, source: 'config' } : { token: null, source: 'new' };
}

async function postJson(runtime, path, body) {
  return runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function getJson(runtime, path, token) {
  return runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

function adminToken(flags) {
  const fromFlag = normaliseSessionId(flags['admin-token']);
  if (fromFlag) return fromFlag;
  return normaliseSessionId(process.env.ANT_ADMIN_TOKEN);
}

function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***');
  }
  return out;
}

async function readFailure(response, secrets = []) {
  let body = '';
  try { body = await response.text(); } catch { /* ignore */ }
  return redact(body.slice(0, 200), secrets);
}

async function remoteBridgeSummary(flags, runtime) {
  const roomId = typeof flags.room === 'string' && flags.room.trim().length > 0 ? flags.room.trim() : null;
  if (!roomId) return null;
  const token = adminToken(flags);
  if (!token) {
    return {
      roomId,
      mappings: null,
      note: 'admin token not present; run remote mapping/admit commands when needed'
    };
  }
  const response = await getJson(runtime, `/api/remote-ant/mappings?roomId=${encodeURIComponent(roomId)}`, token);
  if (!response.ok) {
    return {
      roomId,
      mappings: null,
      note: `mapping lookup failed (${response.status}): ${await readFailure(response, [token])}`
    };
  }
  const body = await response.json();
  const mappings = Array.isArray(body.mappings) ? body.mappings : [];
  return { roomId, mappings, note: null };
}

export async function runConnect(flags, runtime, CliInputError) {
  const name = typeof flags.name === 'string' ? flags.name.trim() : '';
  if (!name) throw new CliInputError('connect requires --name <terminalName>');

  const handle = typeof flags.handle === 'string' && flags.handle.trim().length > 0
    ? flags.handle.trim()
    : null;
  const hasExplicitPid = flags.pid !== undefined;
  const startPidRaw = hasExplicitPid ? Number(flags.pid) : runtime.processPpid ?? process.ppid;
  const initialChain = processIdentityChain(startPidRaw);
  const chain = chooseRegisterPidChain(initialChain, hasExplicitPid);
  if (chain.length === 0) {
    runtime.writeErr('Could not read PID chain (ps unavailable or PID invalid).');
    return 1;
  }

  const pane = detectPane(flags, runtime);
  const session = existingSessionToken(flags, runtime, { pane, name });
  const body = {
    name,
    pids: chain,
    ttl_seconds: parseTtlSeconds(flags.ttl),
    source: 'cli-connect',
    meta: { handle, cwd: runtime.cwd ?? process.cwd() }
  };
  if (handle) body.handle = handle;
  if (pane) body.pane = pane;
  if (flags['agent-kind']) body.agent_kind = flags['agent-kind'];
  if (session.token) body.sessionToken = session.token;

  const response = await postJson(runtime, '/api/identity/register', body);
  if (!response.ok) {
    runtime.writeErr(`connect failed (${response.status}): ${await readFailure(response, [session.token])}`);
    return 1;
  }
  const payload = await response.json();
  const returnedSession = normaliseSessionId(payload.session_id);
  if (returnedSession) {
    const result = persistAntSessionBindingToConfig({
      sessionId: returnedSession,
      pane,
      terminalName: name,
      homeDir: runtime.homeDir
    });
    if (!result.ok) {
      runtime.writeErr(`Warning: connect returned session_id but could not persist it: ${result.error}`);
    }
  }

  const bridge = await remoteBridgeSummary(flags, runtime);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({
      terminal_id: payload.terminal_id,
      name: payload.name,
      handle,
      session_id: returnedSession,
      session_source: session.source,
      pane,
      remote_bridge: bridge
    }));
    return 0;
  }

  runtime.writeOut(`Connected ${payload.name} as ${payload.terminal_id}`);
  if (handle) runtime.writeOut(`handle: ${handle}`);
  if (returnedSession) runtime.writeOut(`session_id: ${returnedSession}`);
  runtime.writeOut(`session_source: ${session.source}`);
  if (pane) runtime.writeOut(`pane: ${pane}`);
  if (bridge) {
    runtime.writeOut(`remote_bridge_room: ${bridge.roomId}`);
    if (Array.isArray(bridge.mappings)) {
      runtime.writeOut(`remote_mappings: ${bridge.mappings.length}`);
      for (const mapping of bridge.mappings) {
        runtime.writeOut(`  ${mapping.id}\t${mapping.remote_instance_label}\t${mapping.direction}\tlast_seen=${mapping.last_seen_at_ms ?? '-'}`);
      }
    } else if (bridge.note) {
      runtime.writeOut(`remote_bridge_note: ${bridge.note}`);
    }
    runtime.writeOut(`remote_admit: ant remote admit --room ${bridge.roomId} --lifetime 48h`);
    runtime.writeOut(`remote_status: ant remote mapping list --room ${bridge.roomId}`);
  }
  return 0;
}
