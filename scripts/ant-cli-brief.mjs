/**
 * `ant brief ...` — the disposable per-terminal working-memory lane.
 *
 * ANT's 4th memory lane (alongside ObsidiANT, mempalace, and room history):
 * a single LOCAL scratch file per terminal that survives context compaction.
 * The brief is the "resume-me, read this first" note an agent leaves for its
 * future self — task, open loops, changed files, last-verified fact, the next
 * action, and LINKS (never inlined content) into the other lanes.
 *
 * Storage: ~/.ant/scratch/<terminalId>/brief.json — ONE file per terminal,
 * overwritten in place. The previous brief is kept at brief.prev.json for a
 * one-step undo. Local only; the brief is NEVER POSTed and MUST hold no
 * secrets (it's plaintext under ~/.ant).
 *
 *   ant brief write [--task T] [--next A] [--fact F] [--plan ID]
 *                   [--loop L]... [--file P]... [--room R]... [--mem M]... [--kg E]...
 *                   [--stdin]                read a full JSON brief from stdin
 *   ant brief read  [--json]                print the brief (table or raw JSON)
 *   ant brief clear                         remove the brief (+ its .prev)
 *
 * terminalId resolution (VERIFIER CORRECTIONS, critical):
 *   (a) terminalId is SERVER-MINTED — resolved via processIdentityChain →
 *       POST /api/identity/whoami (reusing the whoami contract). If the
 *       server is unreachable or returns no id, we DO NOT write to
 *       ~/.ant/scratch//brief.json (an empty key would collapse to a
 *       double-slash path). We fall back to a stable pidChain-derived key
 *       ("pid-<hash>") so a brief still lands somewhere deterministic.
 *   (b) On `read` with no brief at the current key, we look back at the
 *       most-recently-modified brief.json across ~/.ant/scratch/* and offer
 *       it — so a brief written under a server-minted id is still reachable
 *       from a later shell that only resolves the pidChain fallback (or
 *       vice-versa).
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BOOLEAN_FLAGS = new Set(['json', 'stdin']);
const REPEATABLE_FLAGS = new Set(['loop', 'file', 'room', 'mem', 'kg']);

const BRIEF_SCHEMA = 'ant-brief/1';

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  const repeatable = { loop: [], file: [], room: [], mem: [], kg: [] };
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
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
    if (REPEATABLE_FLAGS.has(name)) repeatable[name].push(value);
    else flags[name] = value;
    cursor += 2;
  }
  return { flags, repeatable, positionals };
}

function writeUsage(runtime) {
  runtime.writeOut('ant brief <subcommand>           disposable per-terminal working-memory lane');
  runtime.writeOut('  write [--task T] [--next A] [--fact F] [--plan ID]');
  runtime.writeOut('        [--loop L]... [--file P]... [--room R]... [--mem M]... [--kg E]...');
  runtime.writeOut('        [--stdin]                write the brief (--stdin reads a full JSON brief)');
  runtime.writeOut('  read [--json]                  print the brief (exit 0 if present, 1 if none)');
  runtime.writeOut('  clear                          remove the brief');
}

function scratchRoot(runtime) {
  const home = (runtime && typeof runtime.home === 'string' && runtime.home.length > 0)
    ? runtime.home
    : (process.env.HOME || homedir());
  return join(home, '.ant', 'scratch');
}

/**
 * Stable pidChain-derived fallback key. Hashes the (pid, pid_start) tuples of
 * the caller's process ancestry so the same shell always lands on the same
 * "pid-<hash>" directory, even when the server can't mint a real terminalId.
 * Returns null only if the chain is empty (then the caller must refuse to
 * write rather than collapse to a //double-slash path).
 */
function pidChainFallbackKey() {
  const chain = processIdentityChain();
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const material = chain.map((hop) => `${hop.pid}:${hop.pid_start ?? ''}`).join('|');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 16);
  return `pid-${digest}`;
}

/**
 * Resolve the server-minted terminalId via the whoami contract. Falls back to
 * the pidChain-derived key when the server is unreachable or returns no id.
 * Returns { terminalId, source } where source is 'server' | 'pidchain', or
 * null when neither resolves (chain empty AND server gave nothing) — the
 * caller MUST NOT write under a null key.
 */
async function resolveTerminalKey(runtime) {
  const chain = processIdentityChain();
  let serverId = null;
  if (Array.isArray(chain) && chain.length > 0 && typeof runtime.fetchImpl === 'function') {
    try {
      const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/identity/whoami`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pids: chain })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 200 && payload && payload.status === 'bound') {
        const candidate = payload.terminalId;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          serverId = candidate.trim();
        }
      }
    } catch {
      serverId = null;
    }
  }
  if (serverId) return { terminalId: serverId, source: 'server' };
  const fallback = pidChainFallbackKey();
  if (fallback) return { terminalId: fallback, source: 'pidchain' };
  return null;
}

/**
 * Best-effort handle for the brief metadata. Reuses the same whoami call shape
 * but never blocks a write — returns null on any failure.
 */
async function resolveHandle(runtime) {
  const chain = processIdentityChain();
  if (!Array.isArray(chain) || chain.length === 0 || typeof runtime.fetchImpl !== 'function') return null;
  try {
    const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/identity/whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pids: chain })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 200 && payload && typeof payload.handle === 'string') return payload.handle;
  } catch {
    /* handle is optional metadata */
  }
  return null;
}

function briefDir(runtime, terminalId) {
  return join(scratchRoot(runtime), terminalId);
}

function briefPath(runtime, terminalId) {
  return join(briefDir(runtime, terminalId), 'brief.json');
}

function briefPrevPath(runtime, terminalId) {
  return join(briefDir(runtime, terminalId), 'brief.prev.json');
}

function readStdinBody(runtime, CliInputError) {
  const fsReader = runtime.readStdin ?? ((fd, enc) => readFileSync(fd, enc));
  try {
    return fsReader(0, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new CliInputError(`brief write --stdin failed to read body from stdin: ${reason}`);
  }
}

function emptyPointers() {
  return {};
}

function normalisePointers(rawPointers) {
  const pointers = {};
  if (!rawPointers || typeof rawPointers !== 'object') return pointers;
  if (typeof rawPointers.planID === 'string' && rawPointers.planID.trim()) pointers.planID = rawPointers.planID.trim();
  for (const key of ['roomIDs', 'memIDs', 'kgEntities']) {
    if (Array.isArray(rawPointers[key])) {
      const cleaned = rawPointers[key].map((v) => String(v).trim()).filter(Boolean);
      if (cleaned.length > 0) pointers[key] = cleaned;
    }
  }
  return pointers;
}

function buildBriefFromFlags(flags, repeatable, terminalId, handle) {
  const pointers = emptyPointers();
  if (typeof flags.plan === 'string' && flags.plan.trim()) pointers.planID = flags.plan.trim();
  if (repeatable.room.length > 0) pointers.roomIDs = [...repeatable.room];
  if (repeatable.mem.length > 0) pointers.memIDs = [...repeatable.mem];
  if (repeatable.kg.length > 0) pointers.kgEntities = [...repeatable.kg];
  return {
    schema: BRIEF_SCHEMA,
    terminalId,
    handle: handle ?? null,
    writtenAt: new Date().toISOString(),
    task: typeof flags.task === 'string' ? flags.task : '',
    openLoops: [...repeatable.loop],
    changedFiles: [...repeatable.file],
    lastVerifiedFact: typeof flags.fact === 'string' ? flags.fact : '',
    nextAction: typeof flags.next === 'string' ? flags.next : '',
    pointers
  };
}

function normaliseStdinBrief(parsed, terminalId, handle, CliInputError) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliInputError('brief write --stdin expects a JSON object');
  }
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.length > 0) : []);
  return {
    schema: BRIEF_SCHEMA,
    terminalId,
    handle: typeof parsed.handle === 'string' && parsed.handle.trim() ? parsed.handle.trim() : (handle ?? null),
    writtenAt: new Date().toISOString(),
    task: typeof parsed.task === 'string' ? parsed.task : '',
    openLoops: arr(parsed.openLoops),
    changedFiles: arr(parsed.changedFiles),
    lastVerifiedFact: typeof parsed.lastVerifiedFact === 'string' ? parsed.lastVerifiedFact : '',
    nextAction: typeof parsed.nextAction === 'string' ? parsed.nextAction : '',
    pointers: normalisePointers(parsed.pointers)
  };
}

async function runWrite(args, runtime, CliInputError) {
  const { flags, repeatable } = parseFlags(args, CliInputError);
  const resolved = await resolveTerminalKey(runtime);
  if (!resolved) {
    // VERIFIER CORRECTION (a): no terminalId AND no pidChain → refuse rather
    // than write to ~/.ant/scratch//brief.json (an empty-key double-slash).
    throw new CliInputError(
      'brief write: could not resolve a terminalId (whoami unreachable and PID chain empty) — refusing to write to an empty scratch key'
    );
  }
  const { terminalId, source } = resolved;
  const handle = await resolveHandle(runtime);

  let brief;
  if (flags.stdin !== undefined) {
    const raw = readStdinBody(runtime, CliInputError);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new CliInputError(`brief write --stdin got invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    brief = normaliseStdinBrief(parsed, terminalId, handle, CliInputError);
  } else {
    brief = buildBriefFromFlags(flags, repeatable, terminalId, handle);
  }

  const dir = briefDir(runtime, terminalId);
  mkdirSync(dir, { recursive: true });
  const path = briefPath(runtime, terminalId);
  // One-step undo: snapshot the existing brief to brief.prev.json before overwrite.
  if (existsSync(path)) {
    try {
      writeFileSync(briefPrevPath(runtime, terminalId), readFileSync(path, 'utf-8'), 'utf-8');
    } catch {
      /* prev snapshot is best-effort */
    }
  }
  writeFileSync(path, JSON.stringify(brief, null, 2) + '\n', 'utf-8');

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ wrote: true, path, terminalId, source, brief }));
  } else {
    runtime.writeOut(`Wrote brief for ${terminalId}${source === 'pidchain' ? ' (pidchain fallback key)' : ''}`);
    runtime.writeOut(`  ${path}`);
  }
  return 0;
}

/**
 * Scan ~/.ant/scratch/* for the most-recently-modified brief.json. Used as a
 * lookback when the current key has no brief (VERIFIER CORRECTION b).
 */
function mostRecentBrief(runtime, excludeTerminalId) {
  const root = scratchRoot(runtime);
  if (!existsSync(root)) return null;
  let best = null;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name === excludeTerminalId) continue;
    const candidate = join(root, name, 'brief.json');
    if (!existsSync(candidate)) continue;
    let mtimeMs;
    try {
      mtimeMs = statSync(candidate).mtimeMs;
    } catch {
      continue;
    }
    if (best === null || mtimeMs > best.mtimeMs) {
      best = { terminalId: name, path: candidate, mtimeMs };
    }
  }
  return best;
}

function formatBriefTable(runtime, brief) {
  runtime.writeOut(`task\t${brief.task ?? ''}`);
  runtime.writeOut(`nextAction\t${brief.nextAction ?? ''}`);
  runtime.writeOut(`lastVerifiedFact\t${brief.lastVerifiedFact ?? ''}`);
  runtime.writeOut(`writtenAt\t${brief.writtenAt ?? ''}`);
  runtime.writeOut(`handle\t${brief.handle ?? ''}`);
  runtime.writeOut(`terminalId\t${brief.terminalId ?? ''}`);
  for (const loop of brief.openLoops ?? []) runtime.writeOut(`openLoop\t${loop}`);
  for (const file of brief.changedFiles ?? []) runtime.writeOut(`changedFile\t${file}`);
  const pointers = brief.pointers ?? {};
  if (pointers.planID) runtime.writeOut(`plan\t${pointers.planID}`);
  for (const room of pointers.roomIDs ?? []) runtime.writeOut(`room\t${room}`);
  for (const mem of pointers.memIDs ?? []) runtime.writeOut(`mem\t${mem}`);
  for (const kg of pointers.kgEntities ?? []) runtime.writeOut(`kg\t${kg}`);
}

async function runRead(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const resolved = await resolveTerminalKey(runtime);
  const terminalId = resolved?.terminalId ?? null;
  const path = terminalId ? briefPath(runtime, terminalId) : null;

  if (path && existsSync(path)) {
    const brief = JSON.parse(readFileSync(path, 'utf-8'));
    if (flags.json !== undefined) runtime.writeOut(JSON.stringify(brief));
    else formatBriefTable(runtime, brief);
    return 0;
  }

  // VERIFIER CORRECTION (b): no brief at the current key — look back at the
  // most-recently-modified brief.json elsewhere under ~/.ant/scratch and
  // offer it rather than reporting "none".
  const fallback = mostRecentBrief(runtime, terminalId);
  if (fallback && existsSync(fallback.path)) {
    const brief = JSON.parse(readFileSync(fallback.path, 'utf-8'));
    if (flags.json !== undefined) {
      runtime.writeOut(JSON.stringify({ fromOtherTerminal: fallback.terminalId, brief }));
    } else {
      runtime.writeErr(`(no brief for this terminal — showing most recent brief from ${fallback.terminalId})`);
      formatBriefTable(runtime, brief);
    }
    return 0;
  }

  if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ brief: null }));
  else runtime.writeOut('(no brief on this terminal)');
  return 1;
}

async function runClear(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const resolved = await resolveTerminalKey(runtime);
  const terminalId = resolved?.terminalId ?? null;
  if (!terminalId) {
    if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ cleared: false, reason: 'no terminalId' }));
    else runtime.writeOut('(no terminalId to clear)');
    return 1;
  }
  const path = briefPath(runtime, terminalId);
  const prev = briefPrevPath(runtime, terminalId);
  let removed = false;
  if (existsSync(path)) {
    rmSync(path, { force: true });
    removed = true;
  }
  if (existsSync(prev)) rmSync(prev, { force: true });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ cleared: removed, terminalId }));
  else runtime.writeOut(removed ? `Cleared brief for ${terminalId}` : '(no brief to clear)');
  return removed ? 0 : 1;
}

export async function handleBriefVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'write': return runWrite(args, runtime, CliInputError);
    case 'read': return runRead(args, runtime, CliInputError);
    case 'clear': return runClear(args, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown brief verb: ${action}`);
}
