/**
 * ant handle <bind|list|remove> — manage local-Device fanout bindings.
 *
 * Pattern B local-MCP-gateway (per ant-accounts strategy deck slide 11 +
 * @usermgtclaude CONTRACT.md commit 6fa322b). Each binding declares
 *   handle → local-target
 * where target is "mcp" (route via the Pattern B localhost MCP proxy) or
 * "tmux:<sessionId>" (inject directly into a local tmux pane).
 *
 * Storage layout (per @usermgtclaude msg_v4bk8j4w54):
 *   ~/.ant/active-workspace.json
 *     { activeAccountId: "<acct_id>" }
 *   ~/.ant/account/<acct_id>/devices/<dev_id>/device-token.json   (chmod 600)
 *   ~/.ant/account/<acct_id>/devices/<dev_id>/bindings.json       (chmod 600)
 *
 * Stubs (until Lane A S3 ships POST /api/devices/{link,refresh}):
 * if device-token.json is missing we surface "no active workspace — run
 * `ant account link` first" rather than mint a fake token.
 *
 * The CLI is the only writer for bindings.json; the Swift mention-scanner
 * (Antchat/Core/Bridge/MentionScanner.swift, M3) is read-only.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  readdirSync
} from 'node:fs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleHandleVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'bind': return runBind(flags, runtime, ctx);
    case 'list': return runList(flags, runtime, ctx);
    case 'remove': return runRemove(flags, runtime, ctx);
  }
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut(
      'ant handle <bind|list|remove> [flags]\n' +
      '  bind   --handle @name --target <mcp|tmux:<sessionId>>\n' +
      '  list   [--account <acct_id>] [--json]\n' +
      '  remove --handle @name'
    );
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown handle verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function validateTarget(target, CliInputError) {
  if (target === 'mcp') return;
  if (target.startsWith('tmux:') && target.length > 'tmux:'.length) return;
  throw new CliInputError(`--target must be "mcp" or "tmux:<sessionId>", got "${target}"`);
}

function validateHandle(handle, CliInputError) {
  if (!handle.startsWith('@') || handle.length < 2) {
    throw new CliInputError(`--handle must be a @name (e.g. "@codex"), got "${handle}"`);
  }
}

function antRoot(env) {
  return env?.HOME ? join(env.HOME, '.ant') : join(homedir(), '.ant');
}

function activeWorkspacePath(env) {
  return join(antRoot(env), 'active-workspace.json');
}

function readActiveAccountId(env) {
  const p = activeWorkspacePath(env);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof parsed?.activeAccountId === 'string' && parsed.activeAccountId.length > 0) {
      return parsed.activeAccountId;
    }
  } catch { /* fall through */ }
  return null;
}

function readDeviceTokenForAccount(env, accountId) {
  // device-token.json lives at .../devices/<dev_id>/device-token.json. We
  // don't yet know <dev_id> until we read the file, so list the devices
  // directory and take the first one. Lane A S3 expects exactly one
  // device-token per (account, host) pair.
  const base = join(antRoot(env), 'account', accountId, 'devices');
  if (!existsSync(base)) return null;
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  for (const devId of entries) {
    const tokenPath = join(base, devId, 'device-token.json');
    if (!existsSync(tokenPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(tokenPath, 'utf8'));
      if (parsed?.device_id) return { deviceId: parsed.device_id, accountId };
    } catch { /* try next */ }
  }
  return null;
}

function resolveWorkspace(env, overrideAccount, CliInputError) {
  const accountId = overrideAccount ?? readActiveAccountId(env);
  if (!accountId) {
    throw new CliInputError(
      'no active workspace — run `ant account link` first (or pass --account <acct_id>)'
    );
  }
  const token = readDeviceTokenForAccount(env, accountId);
  if (!token) {
    throw new CliInputError(
      `no device-token for account ${accountId} — run \`ant account link\` first`
    );
  }
  return token;
}

function bindingsPath(env, accountId, deviceId) {
  return join(antRoot(env), 'account', accountId, 'devices', deviceId, 'bindings.json');
}

function readBindings(env, accountId, deviceId) {
  const p = bindingsPath(env, accountId, deviceId);
  if (!existsSync(p)) {
    return { deviceId, accountId, bindings: [], updatedAtMs: 0 };
  }
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  return {
    deviceId,
    accountId,
    bindings: Array.isArray(parsed?.bindings) ? parsed.bindings : [],
    updatedAtMs: typeof parsed?.updatedAtMs === 'number' ? parsed.updatedAtMs : 0
  };
}

function writeBindings(env, file) {
  const p = bindingsPath(env, file.accountId, file.deviceId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(file, null, 2));
  chmodSync(p, 0o600);
}

async function runBind(flags, runtime, ctx) {
  const { CliInputError } = ctx;
  const handle = requireFlag(flags, 'handle', CliInputError);
  const target = requireFlag(flags, 'target', CliInputError);
  validateHandle(handle, CliInputError);
  validateTarget(target, CliInputError);
  const env = runtime.env ?? process.env;
  const ws = resolveWorkspace(env, flags.account, CliInputError);
  const file = readBindings(env, ws.accountId, ws.deviceId);
  const existing = file.bindings.findIndex((b) => b.handle === handle);
  const entry = { handle, target };
  if (existing >= 0) file.bindings[existing] = entry;
  else file.bindings.push(entry);
  file.bindings.sort((a, b) => a.handle.localeCompare(b.handle));
  file.updatedAtMs = Date.now();
  writeBindings(env, file);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ bound: entry, total: file.bindings.length }));
  } else {
    runtime.writeOut(`bound ${handle} → ${target}`);
  }
  return 0;
}

async function runList(flags, runtime, ctx) {
  const { CliInputError } = ctx;
  const env = runtime.env ?? process.env;
  const ws = resolveWorkspace(env, flags.account, CliInputError);
  const file = readBindings(env, ws.accountId, ws.deviceId);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(file));
    return 0;
  }
  if (file.bindings.length === 0) {
    runtime.writeOut('(no bindings)');
    return 0;
  }
  for (const b of file.bindings) runtime.writeOut(`${b.handle}\t${b.target}`);
  return 0;
}

async function runRemove(flags, runtime, ctx) {
  const { CliInputError } = ctx;
  const handle = requireFlag(flags, 'handle', CliInputError);
  validateHandle(handle, CliInputError);
  const env = runtime.env ?? process.env;
  const ws = resolveWorkspace(env, flags.account, CliInputError);
  const file = readBindings(env, ws.accountId, ws.deviceId);
  const before = file.bindings.length;
  file.bindings = file.bindings.filter((b) => b.handle !== handle);
  const removed = before - file.bindings.length;
  file.updatedAtMs = Date.now();
  writeBindings(env, file);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ removed, total: file.bindings.length }));
  } else {
    runtime.writeOut(removed > 0 ? `removed ${handle}` : `${handle} was not bound`);
  }
  return 0;
}
