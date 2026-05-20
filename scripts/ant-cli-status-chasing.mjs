/**
 * ant status chasing — surface threads I spoke last in that have gone
 * quiet. Wraps GET /api/status/chasing.
 *
 * Usage:
 *   ant status chasing --handle @me [--min-idle-minutes 30] [--json]
 *
 * Output: one line per chasing thread, oldest-first:
 *   <postedAt>  <roomId>  <authorHandle>: <body-truncated>
 *
 * --json passes the server payload through unchanged.
 *
 * Returns code 0 on success (including the empty case — prints a
 * friendly "(nothing to chase …)" hint to stdout). CliInputError is
 * thrown for missing --handle or non-numeric --min-idle-minutes.
 *
 * Shipped as a separate file so the existing `ant-cli-status.mjs`
 * stays untouched during this work; the parent integrator adds a
 * `chasing` case into `handleStatusVerb` that imports and calls
 * `handleStatusChasingVerb`.
 */

const BOOLEAN_FLAGS = new Set(['json']);
const BODY_TRUNCATE_LIMIT = 280;

export async function handleStatusChasingVerb(args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (flags.help !== undefined) {
    writeUsage(runtime);
    return 0;
  }

  const handle = requireFlag(flags, 'handle', CliInputError);
  const query = new URLSearchParams({ handle });
  if (flags['min-idle-minutes'] !== undefined) {
    const parsed = Number(flags['min-idle-minutes']);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CliInputError('--min-idle-minutes must be a non-negative number');
    }
    query.set('min-idle-minutes', String(parsed));
  }

  const path = `/api/status/chasing?${query.toString()}`;
  const payload = await fetchJson(runtime, path);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    runtime.writeOut(`(nothing to chase for ${handle})`);
    return 0;
  }
  for (const m of messages) {
    const body = truncateBody(m.body ?? '');
    runtime.writeOut(`${m.postedAt}\t${m.roomId}\t${m.authorHandle}: ${body}`);
  }
  return 0;
}

function writeUsage(runtime) {
  runtime.writeOut('ant status chasing --handle @h [--min-idle-minutes 30] [--json]');
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name) || name === 'help') {
      flags[name] = 'true'; cursor += 1; continue;
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

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

async function fetchJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

function truncateBody(rawBody) {
  const flat = String(rawBody).replace(/\s+/g, ' ').trim();
  if (flat.length <= BODY_TRUNCATE_LIMIT) return flat;
  return `${flat.slice(0, BODY_TRUNCATE_LIMIT - 1)}…`;
}
