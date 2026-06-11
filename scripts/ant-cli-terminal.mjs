/**
 * `ant terminal ...` — operations on a named terminal (JWPK 2026-05-16).
 *
 *   ant terminal name|handle              show the ANThandle for the current pid
 *   ant terminal <name>                   show info for the named terminal
 *   ant terminal <name> namechange <new>  rename
 *   ant terminal <name> post <msg>        post a message into the terminal chat
 *   ant terminal <name> localtmux         print tmux attach command (and print to stdout for caller to pbcopy)
 *   ant terminal <name> sshtmux [--host h] print ssh tmux attach command
 *   ant terminal <name> whatcli           show the agent_kind (claude/codex/pi/…)
 *   ant terminal <name> setcli <kind>     set the agent_kind
 *
 * `name` and `handle` are reserved keywords — they're treated as the
 * current-pid action, not a terminal called "name"/"handle". Tradeoff
 * accepted at the verb-design level.
 *
 * All verbs below are implemented (the Phase-8 deferrals — listchatrooms,
 * listtasks, listmemories, listfiles, search — have since landed in this
 * file; see runListChatrooms/runListTasks/runListMemories/runListFiles/
 * runSearch).
 */

import { processIdentityChain, pidStart as readPidStart } from './ant-cli-identity-chain.mjs';
import {
  resolveTerminalIdentifier,
  makeStandardSendJson
} from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json']);
const KNOWN_AGENT_KINDS = new Set(['claude', 'codex', 'pi', 'gemini', 'qwen', 'copilot']);
const RESERVED_ACTIONS = new Set([
  'name', 'handle',
  'namechange', 'post', 'localtmux', 'sshtmux', 'whatcli', 'setcli',
  'adopt', 'search', 'listchatrooms', 'listfiles', 'listtasks', 'listmemories',
  'history', 'read', 'antread'
]);

const READ_DEFAULT_LINES = 100;
const READ_MAX_LINES = 1000;
// `antread` excludes raw-trust events ("guff") — only the curated kinds.
// Per production distribution: message + tool_call + command + thinking + agent_prompt.
const ANTREAD_KINDS = 'message,tool_call,command,thinking,agent_prompt';
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;

export async function handleTerminalVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;

  // Pure-action verbs that don't take a terminal name (current-pid lookup):
  if (action === 'name' || action === 'handle') {
    return runCurrentTerminalHandle(args, runtime, CliInputError);
  }

  // Otherwise, action IS the terminal identifier; the next token is the sub-verb.
  if (!action) {
    writeUsage(runtime);
    return 1;
  }
  if (action === 'help' || action === '--help') {
    writeUsage(runtime);
    return 0;
  }

  const terminalIdentifier = action;
  const subAction = args[0];
  const subArgs = args.slice(1);

  if (!subAction || !RESERVED_ACTIONS.has(subAction)) {
    // No sub-action — just print info for the named terminal.
    return runShowTerminal(terminalIdentifier, subArgs, runtime, CliInputError);
  }

  switch (subAction) {
    case 'namechange': return runNameChange(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'post': return runPost(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'localtmux': return runLocalTmux(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'sshtmux': return runSshTmux(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'whatcli': return runWhatCli(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'setcli': return runSetCli(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'adopt': return runAdopt(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'search': return runSearch(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'listchatrooms': return runListChatRooms(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'listfiles': return runListFiles(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'listtasks': return runListTasks(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'listmemories': return runListMemories(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'history': return runHistory(terminalIdentifier, subArgs, runtime, CliInputError);
    case 'read': return runRead(terminalIdentifier, subArgs, runtime, CliInputError, false);
    case 'antread': return runRead(terminalIdentifier, subArgs, runtime, CliInputError, true);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown terminal sub-verb: ${subAction}`);
  }
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
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
    flags[name] = value;
    cursor += 2;
  }
  return { flags, positionals };
}

function writeUsage(runtime) {
  runtime.writeOut('ant terminal <subcommand>');
  runtime.writeOut('  name | handle                              current pid → ANThandle');
  runtime.writeOut('  <name>                                     show info for the named terminal');
  runtime.writeOut('  <name> namechange <new-name>');
  runtime.writeOut('  <name> post <msg...>                       post into terminal chat');
  runtime.writeOut('  <name> localtmux                           print local tmux attach command');
  runtime.writeOut('  <name> sshtmux [--host HOST]               print ssh tmux attach command');
  runtime.writeOut('  <name> whatcli                             show agent_kind');
  runtime.writeOut('  <name> setcli <kind>                       set agent_kind (claude|codex|pi|gemini|qwen|copilot)');
  runtime.writeOut('  <name> adopt --pid PID [--pid-start START] [--ttl SEC] [--reason TEXT] [--admin-token TOKEN]');
  runtime.writeOut('  <name> history [--since 5m|1h] [--grep text] [--limit N] [--raw] [--json]  query terminal history');
}

async function runCurrentTerminalHandle(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const chain = processIdentityChain();
  // POST /api/identity/resolve with the pidChain + durable session → terminalId.
  const sendJson = makeStandardSendJson(runtime);
  let resolved;
  try {
    const sessionId = durableSessionIdForRuntime(runtime);
    resolved = await sendJson(
      '/api/identity/resolve',
      'POST',
      sessionId ? { pids: chain, sessionId } : { pids: chain }
    );
  } catch (cause) {
    throw new CliInputError(`could not resolve current pidChain to a terminal: ${cause.message ?? cause}`);
  }
  if (!resolved?.terminal_id && !resolved?.terminalId) {
    runtime.writeOut('(no terminal resolved from current pidChain — run `ant register` from this shell first)');
    return 1;
  }
  const terminalId = resolved.terminal_id ?? resolved.terminalId;
  // Look up the full record for handle + derivedHandle:
  const terminal = await resolveTerminalIdentifier(runtime, terminalId, CliInputError).catch(() => null);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ terminalId, ...(terminal ?? {}) }));
  } else if (terminal) {
    runtime.writeOut(`${terminal.derivedHandle ?? terminal.handle ?? '@?'}  (terminal "${terminal.name}", session ${terminal.sessionId})`);
  } else {
    runtime.writeOut(`Resolved to terminal id ${terminalId} (no terminal_records row).`);
  }
  return 0;
}

function normaliseDurableSessionId(raw) {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function durableSessionIdForRuntime(runtime) {
  const envSession = normaliseDurableSessionId(process.env.ANT_SESSION_ID);
  if (envSession) return envSession;
  const pane =
    normaliseDurableSessionId(runtime.envTmuxPane) ??
    normaliseDurableSessionId(process.env.TMUX_PANE) ??
    normaliseDurableSessionId(process.env.WEZTERM_PANE);
  const byPane = runtime.config?.antSessions?.byPane;
  if (pane && byPane && typeof byPane === 'object') {
    const paneSession = normaliseDurableSessionId(byPane[pane]);
    if (paneSession) return paneSession;
  }
  return null;
}

async function runShowTerminal(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(terminal));
  } else {
    runtime.writeOut(`Terminal "${terminal.name}"`);
    runtime.writeOut(`  sessionId:      ${terminal.sessionId}`);
    runtime.writeOut(`  agentKind:      ${terminal.agentKind ?? '(unset)'}`);
    runtime.writeOut(`  handle:         ${terminal.handle ?? '(unset)'}`);
    runtime.writeOut(`  derivedHandle:  ${terminal.derivedHandle}`);
    runtime.writeOut(`  terminalChat:  ${terminal.linkedChatRoomId ?? '(none)'}`);
    runtime.writeOut(`  tmuxPane:       ${terminal.tmuxTargetPane}`);
    runtime.writeOut(`  alive:          ${terminal.alive ?? '?'}`);
  }
  return 0;
}

async function runNameChange(identifier, args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const newName = positionals[0] ?? flags['new-name'];
  if (!newName) throw new CliInputError('namechange needs a new name (positional or --new-name)');
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const updated = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}`, 'PATCH', { name: newName });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(updated));
  } else {
    runtime.writeOut(`Renamed terminal ${terminal.sessionId}: "${terminal.name}" → "${updated.name}"`);
  }
  return 0;
}

async function runPost(identifier, args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const message = (flags.msg ?? flags.body ?? positionals.join(' ')).trim();
  if (!message) throw new CliInputError('post needs a message (positional or --msg)');
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  if (!terminal.linkedChatRoomId) {
    throw new CliInputError(`terminal "${terminal.name}" has no terminal chat`);
  }
  const sendJson = makeStandardSendJson(runtime);
  const payload = { body: message, pidChain: processIdentityChain() };
  const result = await sendJson(
    `/api/chat-rooms/${encodeURIComponent(terminal.linkedChatRoomId)}/messages`,
    'POST',
    payload
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const m = result?.message ?? {};
    runtime.writeOut(`Posted ${m.id ?? '?'} as ${m.authorHandle ?? '?'} into "${terminal.name}" terminal chat (${terminal.linkedChatRoomId}).`);
  }
  return 0;
}

async function runLocalTmux(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const command = `tmux attach-session -t ${terminal.sessionId}`;
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ command }));
  } else {
    runtime.writeOut(command);
  }
  return 0;
}

async function runSshTmux(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  // Per pre-launch security scrub: no operator-infra hostname literals.
  // Operator must pass --host or set ANT_SSH_HOST.
  const host = flags.host ?? process.env.ANT_SSH_HOST;
  if (!host) {
    throw new CliInputError('ssh host required — pass --host or set ANT_SSH_HOST env');
  }
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const command = `ssh ${host} -t tmux attach-session -t ${terminal.sessionId}`;
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ command, host }));
  } else {
    runtime.writeOut(command);
  }
  return 0;
}

async function runWhatCli(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ sessionId: terminal.sessionId, agentKind: terminal.agentKind }));
  } else {
    runtime.writeOut(terminal.agentKind ?? '(unset)');
  }
  return 0;
}

async function runSetCli(identifier, args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const kind = positionals[0] ?? flags.kind;
  if (!kind) throw new CliInputError('setcli needs a kind argument (e.g. claude, codex, pi, gemini, qwen, copilot)');
  if (!KNOWN_AGENT_KINDS.has(kind)) {
    throw new CliInputError(`unknown kind "${kind}". Must be one of: ${[...KNOWN_AGENT_KINDS].join(', ')}`);
  }
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const updated = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}`, 'PATCH', { agentKind: kind });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(updated));
  } else {
    runtime.writeOut(`Set agentKind on ${terminal.sessionId}: ${terminal.agentKind ?? '(unset)'} → ${updated.agentKind}`);
  }
  return 0;
}

async function runAdopt(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const pid = Number(flags.pid);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new CliInputError('adopt needs --pid <positive number>');
  }
  const pidStart = flags['pid-start'] ?? readPidStart(Math.floor(pid));
  if (!pidStart) {
    throw new CliInputError('adopt could not read the process start time; pass --pid-start <ps lstart string>');
  }
  const adminToken = flags['admin-token'] ?? runtime.env?.ANT_ADMIN_TOKEN ?? process.env.ANT_ADMIN_TOKEN;
  if (!adminToken) {
    throw new CliInputError('adopt requires admin auth; pass --admin-token or set ANT_ADMIN_TOKEN');
  }
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const body = {
    pid: Math.floor(pid),
    pidStart,
    ...(flags.ttl ? { ttlSeconds: Number(flags.ttl) } : {}),
    ...(flags.reason ? { reason: flags.reason } : {})
  };
  const response = await runtime.fetchImpl(
    `${runtime.serverUrl}/api/terminals/${encodeURIComponent(terminal.sessionId)}/adopt`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CliInputError(`adopt failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const result = await response.json();
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    runtime.writeOut(`Adopted pid ${result.adopted?.pid ?? pid} into ${terminal.name} (${result.handle ?? terminal.derivedHandle ?? terminal.handle ?? '@?'}) for ${result.adopted?.ttlSeconds ?? body.ttlSeconds ?? 900}s.`);
  }
  return 0;
}

async function runSearch(identifier, args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const query = (flags.q ?? flags.query ?? positionals.join(' ')).trim();
  if (!query) throw new CliInputError('search needs a query (positional or --q)');
  const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT,
    flags.limit ? Number(flags.limit) : SEARCH_DEFAULT_LIMIT));
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  if (!terminal.linkedChatRoomId) {
    throw new CliInputError(`terminal "${terminal.name}" has no terminal chat`);
  }
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/chat-rooms/${encodeURIComponent(terminal.linkedChatRoomId)}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    'GET'
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
  } else {
    const matches = result?.matches ?? [];
    if (matches.length === 0) {
      runtime.writeOut(`(no matches for "${query}" in terminal "${terminal.name}" terminal chat)`);
    } else {
      for (const m of matches) {
        runtime.writeOut(`${m.postedAt}\t${m.authorHandle}\t${m.body}`);
      }
    }
  }
  return 0;
}

async function runListChatRooms(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const response = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}/chatrooms`, 'GET');
  const chatRooms = Array.isArray(response?.chatRooms) ? response.chatRooms : [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ sessionId: terminal.sessionId, chatRooms }));
  } else if (chatRooms.length === 0) {
    runtime.writeOut(`(no chat rooms for terminal "${terminal.name}")`);
  } else {
    for (const room of chatRooms) runtime.writeOut(`${room.id}\t${room.name}\t${room.role}`);
  }
  return 0;
}

async function runListFiles(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}/files`, 'GET');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }
  const refs = result?.fileRefs ?? [];
  if (refs.length === 0) {
    runtime.writeOut(`(no flagged files for terminal "${terminal.name}")`);
    return 0;
  }
  for (const ref of refs) {
    const labelChunk = ref.label ? ` (${ref.label})` : '';
    runtime.writeOut(`${ref.id}\t${ref.filePath ?? ref.file_path}${labelChunk}`);
  }
  return 0;
}

async function runListTasks(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}/tasks`, 'GET');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }
  const tasks = result?.tasks ?? [];
  if (tasks.length === 0) {
    runtime.writeOut(`(no tasks bound to terminal "${terminal.name}")`);
    return 0;
  }
  for (const t of tasks) {
    const title = t.title ?? t.subject ?? '(untitled)';
    runtime.writeOut(`${t.id}\t${t.status ?? '?'}\t${t.assignedTo ?? t.assigned_to ?? '-'}\t${title}`);
  }
  return 0;
}

async function runListMemories(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}/memories`, 'GET');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }
  const rows = result?.memories ?? [];
  if (rows.length === 0) {
    runtime.writeOut(`(no scope=terminal memories for "${terminal.name}")`);
    return 0;
  }
  for (const m of rows) runtime.writeOut(`${m.key}\t${m.value}`);
  return 0;
}

/**
 * `ant terminal <name> read --lines N` — raw scrollback (all kinds, no filter).
 * `ant terminal <name> antread --lines N` — ANT-cleaned view (skips trust=raw "guff").
 *
 * Backed by GET /api/terminals/[id]/run-events?limit=N&kinds=...
 * antread applies a curated kind ALLOWLIST (ANTREAD_KINDS) — only those kinds render; read passes everything.
 */

/**
 * \`ant terminal <name> history [--since 5m|1h] [--grep text] [--limit N] [--raw] [--json]\`
 * v3-parity terminal history query with relative time, grep search, and raw ANSI.
 * Backed by GET /api/terminals/[id]/run-events.
 */
async function runHistory(identifier, args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);

  const qs = new URLSearchParams();
  qs.set("limit", String(Math.max(1, Math.min(READ_MAX_LINES,
    flags.limit ? Number(flags.limit) : READ_DEFAULT_LINES))));
  if (flags.since) qs.set("since", String(flags.since));
  if (flags.grep) qs.set("grep", String(flags.grep));
  if (flags.raw !== undefined) qs.set("raw", "1");

  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/terminals/${encodeURIComponent(terminal.sessionId)}/run-events?${qs.toString()}`,
    "GET"
  );

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }

  const events = result?.events ?? [];
  if (events.length === 0) {
    runtime.writeOut(`(no history for terminal "${terminal.name}")`);
    return 0;
  }

  if (result.mode === "search") {
    runtime.writeOut(`Matches for "${result.query}" in ${terminal.name} (${events.length} hits):`);
    for (const ev of events) {
      const ts = new Date(ev.ts_ms).toISOString().slice(11, 23);
      const text = (ev.text ?? "").replace(/\n/g, "\\n");
      runtime.writeOut(`${ts}  [${ev.kind}]  ${text}`);
    }
    return 0;
  }

  // Default range mode — print oldest-first
  const ordered = [...events].reverse();
  for (const ev of ordered) {
    const ts = new Date(ev.ts_ms).toISOString().slice(11, 23);
    const text = (ev.text ?? "").replace(/\n/g, "\\n");
    runtime.writeOut(`${ts}  [${ev.kind}]  ${text}`);
  }
  return 0;
}

async function runRead(identifier, args, runtime, CliInputError, antMode) {
  const { flags } = parseFlags(args, CliInputError);
  const lines = Math.max(1, Math.min(READ_MAX_LINES,
    flags.lines ? Number(flags.lines) : READ_DEFAULT_LINES));
  const terminal = await resolveTerminalIdentifier(runtime, identifier, CliInputError);
  const kindsParam = antMode ? `&kinds=${encodeURIComponent(ANTREAD_KINDS)}` : '';
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/terminals/${encodeURIComponent(terminal.sessionId)}/run-events?limit=${lines}${kindsParam}`,
    'GET'
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(result));
    return 0;
  }
  const events = result?.events ?? [];
  if (events.length === 0) {
    runtime.writeOut(`(no events for terminal "${terminal.name}"${antMode ? ' — ANT-cleaned view' : ''})`);
    return 0;
  }
  // Print oldest-first so the screen reads chronologically.
  const ordered = [...events].reverse();
  for (const ev of ordered) {
    const ts = new Date(ev.ts_ms).toISOString().slice(11, 23);
    const text = (ev.text ?? '').replace(/\n/g, '\\n');
    runtime.writeOut(`${ts}\t[${ev.kind}]\t${text}`);
  }
  return 0;
}
