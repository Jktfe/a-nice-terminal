/**
 * ant register / ant add / ant resolve — CLI verbs for identity + membership.
 *
 * Three top-level verbs share this file, each exporting its own handle*Verb
 * entry point so the DISPATCH table in ant-cli.mjs can route to them:
 *
 *   ant register --handle @x --name terminalN [--ttl 12h]
 *     Default-on PID chain walk. Dual-reg: fresh-ANT primary, v3 best-effort.
 *
 *   ant add session --pid PID --name NAME
 *   ant add membership --room ROOM_ID --handle @h --name TERMINAL_NAME
 *
 *   ant resolve [--room ROOM_ID]
 *     Round-trip helper for tests + ops.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const PARSE_TTL_PATTERN = /^(\d+)(s|m|h)?$/;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const V3_SERVER_URL_DEFAULT = process.env.ANT_V3_SERVER_URL ?? 'http://127.0.0.1:6458';
const BOOLEAN_FLAGS = new Set(['mirror-v3']);

export async function handleRegisterVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const fullArgs = action !== undefined && String(action).startsWith('--')
    ? [action, ...args]
    : args;
  const flags = parseFlags(fullArgs, CliInputError);
  return runRegister(flags, runtime, CliInputError);
}

export async function handleAddVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  if (action === 'session')    return runAddSession(flags, runtime, CliInputError);
  if (action === 'membership') return runAddMembership(flags, runtime, CliInputError);
  if (action === 'help' || action === '--help' || action === undefined) {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  writeUsage(runtime);
  throw new CliInputError(`unknown add subverb: ${action}`);
}

export async function handleResolveVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const fullArgs = action !== undefined && String(action).startsWith('--')
    ? [action, ...args]
    : args;
  const flags = parseFlags(fullArgs, CliInputError);
  return runResolve(flags, runtime, CliInputError);
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function writeUsage(runtime) {
  runtime.writeOut('ant register --handle @x --name terminalN [--ttl 12h] [--pane PANE_ID] [--agent-kind claude_code] [--mirror-v3]');
  runtime.writeOut('ant add session --pid PID --name NAME [--ttl 12h] [--pane PANE_ID] [--agent-kind claude_code]');
  runtime.writeOut('ant add membership --room ROOM_ID --handle @h --name TERMINAL_NAME');
  runtime.writeOut('ant resolve [--room ROOM_ID]');
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

async function postJson(runtime, url, body) {
  return runtime.fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// 0.1.8 slice A (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// when --pid is not given, prefer the grandparent over process.ppid so
// `ant register` from MSYS2 bash doesn't anchor to a one-off cygwin
// helper that dies the moment the register call returns. Subsequent
// `ant chat send` invocations spawn fresh helpers (different PIDs) but
// the bash / shell ancestor stays put, so the server's pidChain lookup
// matches on the bash entry of both register-time and resolve-time
// chains.
//
// Safe on Mac/Linux too: chain[0] (the immediate shell) is stable
// across invocations, but chain[1] (the terminal emulator) is also
// stable AND appears in every subsequent resolve chain — so registering
// against either yields a match. We pick the longer-lived ancestor by
// default for the MSYS2 case without regressing the POSIX case.
//
// Explicit --pid still wins; users with a known stable PID (e.g.
// claude.exe pid 51680 from Xeno's manual recovery) bypass this.
export function chooseRegisterPidChain(initialChain, hasExplicitPid) {
  if (hasExplicitPid) return initialChain;
  if (initialChain.length < 2) return initialChain;
  return initialChain.slice(1);
}

async function runRegister(flags, runtime, CliInputError) {
  const handle = flags.handle;
  const name = flags.name;
  if (!name) throw new CliInputError('register requires --name <terminalName>');
  const ttlSeconds = parseTtlSeconds(flags.ttl);
  const hasExplicitPid = flags.pid !== undefined;
  const startPidRaw = hasExplicitPid ? Number(flags.pid) : runtime.processPpid ?? process.ppid;
  const initialChain = processIdentityChain(startPidRaw);
  const chain = chooseRegisterPidChain(initialChain, hasExplicitPid);
  if (chain.length === 0) {
    runtime.writeErr('Could not read PID chain (ps unavailable or PID invalid).');
    return 1;
  }

  const registerBody = {
    name,
    pids: chain,
    ttl_seconds: ttlSeconds,
    source: 'cli-register',
    meta: { handle: handle ?? null, cwd: runtime.cwd ?? process.cwd() }
  };
  // Phase A2 (JWPK A Team msg_7uvr35x0xr 2026-05-29, design Q1 default A):
  // when --pane isn't explicit, auto-detect from caller env. tmux exports
  // TMUX_PANE (e.g. "%42"); wezterm exports WEZTERM_PANE. Tests can inject
  // via runtime.envTmuxPane so the assertion stays deterministic without
  // mutating process.env.
  const detectedPane = flags.pane ?? runtime.envTmuxPane ?? process.env.TMUX_PANE ?? process.env.WEZTERM_PANE ?? null;
  if (detectedPane) registerBody.pane = detectedPane;
  if (flags['agent-kind']) registerBody.agent_kind = flags['agent-kind'];

  const primaryResp = await postJson(runtime, `${runtime.serverUrl}/api/identity/register`, registerBody);
  if (!primaryResp.ok) {
    const text = await primaryResp.text().catch(() => '');
    runtime.writeErr(`fresh-ANT register failed (${primaryResp.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const primaryBody = await primaryResp.json();
  runtime.writeOut(`Registered ${primaryBody.name} as ${primaryBody.terminal_id} (fresh-ANT)`);

  if (flags['mirror-v3'] !== undefined) {
    await mirrorToV3BestEffort(runtime, registerBody);
  }
  return 0;
}

async function mirrorToV3BestEffort(runtime, registerBody) {
  try {
    const v3Resp = await postJson(runtime, `${V3_SERVER_URL_DEFAULT}/api/identity/register`, registerBody);
    if (v3Resp.ok) runtime.writeOut(`v3 mirror ok`);
    else runtime.writeErr(`v3 mirror failed (${v3Resp.status}) — fresh-ANT registration succeeded`);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    runtime.writeErr(`v3 mirror unreachable: ${msg} — fresh-ANT registration succeeded`);
  }
}

async function runAddSession(flags, runtime, CliInputError) {
  const pid = Number(flags.pid);
  const name = flags.name;
  if (!Number.isFinite(pid) || pid <= 0) throw new CliInputError('add session needs --pid <number>');
  if (!name) throw new CliInputError('add session needs --name <terminalName>');
  const body = {
    pid,
    pid_start: flags['pid-start'] ?? null,
    name,
    ttl_seconds: parseTtlSeconds(flags.ttl),
    source: 'cli-add-session'
  };
  if (flags.pane) body.pane = flags.pane;
  if (flags['agent-kind']) body.agent_kind = flags['agent-kind'];
  const response = await postJson(runtime, `${runtime.serverUrl}/api/sessions/add`, body);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`add session failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const payload = await response.json();
  runtime.writeOut(`Added session ${payload.name} as ${payload.terminal_id}`);
  return 0;
}

async function runAddMembership(flags, runtime, CliInputError) {
  const roomId = flags.room;
  const handle = flags.handle;
  const terminalName = flags.name;
  if (!roomId || !handle || !terminalName) {
    throw new CliInputError('add membership needs --room ROOM_ID --handle @h --name TERMINAL_NAME');
  }
  const body = { room_id: roomId, handle, terminal_name: terminalName };
  const response = await postJson(runtime, `${runtime.serverUrl}/api/sessions/add`, body);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`add membership failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const payload = await response.json();
  runtime.writeOut(`Membership ${payload.handle} -> ${payload.terminal_id} in ${payload.room_id}`);
  return 0;
}

async function runResolve(flags, runtime, _CliInputError) {
  const chain = processIdentityChain();
  const body = { pids: chain };
  if (flags.room) body.room_id = flags.room;
  const response = await postJson(runtime, `${runtime.serverUrl}/api/identity/resolve`, body);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`resolve failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const payload = await response.json();
  runtime.writeOut(JSON.stringify(payload));
  return 0;
}
