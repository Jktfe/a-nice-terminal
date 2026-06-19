/**
 * ant away — terminal wrapper for the server-observable away-mode tiers.
 *
 * The room UI already writes /api/away-modes/:handle. This CLI keeps the same
 * source of truth reachable from operator/agent panes:
 *
 *   ant away get --handle @h
 *   ant away set --handle @h --tier active|away-desk|away-office|away-phone
 *   ant away clear --handle @h
 *   ant away list [--tier away-phone] [--limit 20]
 */

const BOOLEAN_FLAGS = new Set(['json']);
const TIER_ALIASES = {
  active: 'active',
  desk: 'away-desk',
  'away-desk': 'away-desk',
  office: 'away-office',
  'away-office': 'away-office',
  phone: 'away-phone',
  'away-phone': 'away-phone'
};

export async function handleAwayVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'get':
      return runGet(flags, runtime, CliInputError);
    case 'set':
      return runSet(flags, runtime, CliInputError);
    case 'clear':
      return runClear(flags, runtime, CliInputError);
    case 'list':
      return runList(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown away verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
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
  runtime.writeOut('ant away get --handle @h [--admin-token TOKEN] [--json]');
  runtime.writeOut('ant away set --handle @h --tier active|away-desk|away-office|away-phone [--intensity 0..100] [--note TEXT] [--expected-back-ms MS] [--admin-token TOKEN] [--json]');
  runtime.writeOut('ant away clear --handle @h [--admin-token TOKEN] [--json]');
  runtime.writeOut('ant away list [--tier active|away-desk|away-office|away-phone] [--limit N] [--admin-token TOKEN] [--json]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value.trim();
}

function normalizeHandle(rawHandle) {
  const trimmed = String(rawHandle ?? '').trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function normalizeTier(rawTier, CliInputError) {
  const normalized = TIER_ALIASES[String(rawTier ?? '').trim().toLowerCase()];
  if (!normalized) {
    throw new CliInputError('tier must be active|away-desk|away-office|away-phone');
  }
  return normalized;
}

function parseOptionalInteger(flags, name, CliInputError) {
  if (flags[name] === undefined) return undefined;
  const parsed = Number(flags[name]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliInputError(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalIntensity(flags, CliInputError) {
  const parsed = parseOptionalInteger(flags, 'intensity', CliInputError);
  if (parsed === undefined) return undefined;
  if (parsed > 100) throw new CliInputError('--intensity must be 0..100');
  return parsed;
}

function adminToken(flags, runtime, CliInputError) {
  const token = flags['admin-token'] ?? runtime.adminToken ?? process.env.ANT_ADMIN_TOKEN ?? process.env.ANT_ADMIN_BEARER;
  if (!token) throw new CliInputError('admin token required: pass --admin-token, set ANT_ADMIN_TOKEN, or configure runtime.adminToken');
  return token;
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

function authHeaders(flags, runtime, CliInputError, extra = {}) {
  return {
    ...extra,
    authorization: `Bearer ${adminToken(flags, runtime, CliInputError)}`
  };
}

function writeJsonOrText(runtime, flags, payload, lines) {
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return;
  }
  for (const line of lines) runtime.writeOut(line);
}

function formatModeLine(mode) {
  const note = mode.note ? `\tnote=${mode.note}` : '';
  const expected = mode.expectedBackMs ? `\texpectedBackMs=${mode.expectedBackMs}` : '';
  return `${mode.handle}\t${mode.tier}\tintensity=${mode.intensity}${expected}${note}`;
}

async function runGet(flags, runtime, CliInputError) {
  const handle = normalizeHandle(requireFlag(flags, 'handle', CliInputError));
  const payload = await fetchJson(runtime, `/api/away-modes/${encodeURIComponent(handle)}`, {
    headers: authHeaders(flags, runtime, CliInputError)
  });
  writeJsonOrText(runtime, flags, payload, [formatModeLine(payload.mode)]);
  return 0;
}

async function runSet(flags, runtime, CliInputError) {
  const handle = normalizeHandle(requireFlag(flags, 'handle', CliInputError));
  const tier = normalizeTier(requireFlag(flags, 'tier', CliInputError), CliInputError);
  const body = { tier };
  const intensity = parseOptionalIntensity(flags, CliInputError);
  if (intensity !== undefined) body.intensity = intensity;
  if (typeof flags.note === 'string') body.note = flags.note;
  const expectedBackMs = parseOptionalInteger(flags, 'expected-back-ms', CliInputError);
  if (expectedBackMs !== undefined) body.expectedBackMs = expectedBackMs;
  const payload = await fetchJson(runtime, `/api/away-modes/${encodeURIComponent(handle)}`, {
    method: 'PUT',
    headers: authHeaders(flags, runtime, CliInputError, { 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, [`Away mode set: ${formatModeLine(payload.mode)}`]);
  return 0;
}

async function runClear(flags, runtime, CliInputError) {
  const handle = normalizeHandle(requireFlag(flags, 'handle', CliInputError));
  const payload = await fetchJson(runtime, `/api/away-modes/${encodeURIComponent(handle)}`, {
    method: 'DELETE',
    headers: authHeaders(flags, runtime, CliInputError)
  });
  writeJsonOrText(runtime, flags, payload, [`Away mode cleared for ${handle}`]);
  return 0;
}

async function runList(flags, runtime, CliInputError) {
  const query = new URLSearchParams();
  if (flags.tier !== undefined) query.set('tier', normalizeTier(flags.tier, CliInputError));
  const limit = parseOptionalInteger(flags, 'limit', CliInputError);
  if (limit !== undefined) query.set('limit', String(limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await fetchJson(runtime, `/api/away-modes${suffix}`, {
    headers: authHeaders(flags, runtime, CliInputError)
  });
  const modes = Array.isArray(payload.modes) ? payload.modes : [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (modes.length === 0) {
    runtime.writeOut('No away modes.');
    return 0;
  }
  for (const mode of modes) runtime.writeOut(formatModeLine(mode));
  return 0;
}
