/**
 * `ant memory ...` — local Markdown memory-pack + persisted KV memory CLI.
 *
 * Markdown memory pack verbs:
 *   ant memory vault set --path PATH | get | clear
 *   ant memory recall [--MEM-LOCATION PATH] [--search TEXT | --memID ID]
 *   ant memory add [--MEM-LOCATION PATH] (--roomID ROOM_ID | --all-rooms) --memID ID
 *   ant memory remove [--MEM-LOCATION PATH] --roomID ROOM_ID --memID ID
 *
 * Legacy key/value memory verbs:
 *   ant memory get <key>
 *   ant memory put <key> --value TEXT [--scope global|terminal|room]
 *                        [--target SCOPE_TARGET] [--by HANDLE] [--json]
 *   ant memory list [--prefix P | --terminal NAME | --room NAME] [--json]
 *   ant memory delete <key> [--by HANDLE] [--json]
 *   ant memory audit [--key K] [--limit N] [--json]
 */

import {
  makeStandardSendJson,
  resolveTerminalIdentifier,
  resolveChatRoomIdentifier
} from './ant-cli-shared-resolve.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

const BOOLEAN_FLAGS = new Set(['json', 'all-rooms']);

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
  runtime.writeOut('ant memory <subcommand>');
  runtime.writeOut('  vault set --path PATH | get | clear       configure default memory pack root');
  runtime.writeOut('  recall [--MEM-LOCATION PATH] [--search TEXT | --memID ID]');
  runtime.writeOut('  add [--MEM-LOCATION PATH] (--roomID ROOM_ID | --all-rooms) --memID MEM_ID');
  runtime.writeOut('  remove [--MEM-LOCATION PATH] --roomID ROOM_ID --memID MEM_ID');
  runtime.writeOut('  get <key>                                fetch one memory row');
  runtime.writeOut('  put <key> --value TEXT [--scope S] [--target T] [--by HANDLE]');
  runtime.writeOut('  list [--prefix P | --terminal NAME | --room NAME]');
  runtime.writeOut('  delete <key> [--by HANDLE]');
  runtime.writeOut('  audit [--key K] [--limit N]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliInputError(`memory command needs --${name} VALUE`);
  }
  return value;
}

function memoryVaultSettingsPath() {
  const home = process.env.HOME || homedir();
  return join(home, '.ant', 'memory-vault.json');
}

function readPersistedMemoryVaultPath() {
  const filePath = memoryVaultSettingsPath();
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    const candidate = parsed?.vaultPath;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
  } catch {
    return null;
  }
}

function writePersistedMemoryVaultPath(path) {
  const filePath = memoryVaultSettingsPath();
  mkdirSync(dirname(filePath), { recursive: true });
  const vaultPath = typeof path === 'string' && path.trim().length > 0 ? path.trim() : null;
  writeFileSync(filePath, JSON.stringify({ vaultPath }, null, 2) + '\n', 'utf-8');
}

function configuredMemoryPackRoot(runtime) {
  const envRoot = process.env.ANT_MEMORY_VAULT_PATH?.trim() || process.env.ANT_MEMORY_PACK_ROOT?.trim();
  if (envRoot) return envRoot;
  const config = runtime.config ?? {};
  if (typeof config.memoryPackRoot === 'string' && config.memoryPackRoot.trim()) return config.memoryPackRoot.trim();
  if (typeof config.memory_pack_root === 'string' && config.memory_pack_root.trim()) return config.memory_pack_root.trim();
  if (typeof config.memoryVaultPath === 'string' && config.memoryVaultPath.trim()) return config.memoryVaultPath.trim();
  if (typeof config.memory_vault_path === 'string' && config.memory_vault_path.trim()) return config.memory_vault_path.trim();
  if (config.memory && typeof config.memory === 'object') {
    const nested = config.memory.packRoot ?? config.memory.pack_root ?? config.memory.vaultPath ?? config.memory.vault_path;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return readPersistedMemoryVaultPath();
}

function resolveMemoryLocation(flags, runtime, CliInputError) {
  const explicit = flags['MEM-LOCATION'];
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim();
  const configured = configuredMemoryPackRoot(runtime);
  if (configured) return configured;
  throw new CliInputError('memory command needs --MEM-LOCATION or configured memoryPackRoot');
}

function pathWithPidChain(path) {
  const url = new URL(path, 'http://ant.local');
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  return `${url.pathname}${url.search}`;
}

function walkMarkdownFiles(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue;
    const fullPath = join(root, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) out.push(...walkMarkdownFiles(fullPath));
    else if (stat.isFile() && name.endsWith('.md')) out.push(fullPath);
  }
  return out;
}

function parseMemoryFileForCli(root, filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  const body = frontmatterMatch ? frontmatterMatch[2] : raw;
  const idFromFrontmatter = frontmatter.match(/^memory_id:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  const memoryId = idFromFrontmatter || filePath.split('/').pop().replace(/\.md$/, '');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || memoryId;
  return {
    memoryId,
    title,
    filePath,
    relativePath: relative(root, filePath),
    raw,
    searchableText: `${memoryId}\n${title}\n${relative(root, filePath)}\n${raw}`.toLowerCase()
  };
}

function findMemoryPackEntries(memLocation) {
  const root = resolve(memLocation);
  return walkMarkdownFiles(root).map((filePath) => parseMemoryFileForCli(root, filePath));
}

function findMemoryById(memLocation, memID, CliInputError) {
  const entries = findMemoryPackEntries(memLocation);
  const found = entries.find((entry) => entry.memoryId === memID || entry.relativePath === memID || entry.relativePath === `${memID}.md`);
  if (!found) throw new CliInputError(`memory ${memID} not found in ${memLocation}`);
  return found;
}

function parseLinkedRooms(raw) {
  const match = raw.match(/^linked_rooms:\s*\[([^\]]*)\]\s*$/m);
  if (!match) return [];
  return match[1].split(',').map((part) => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function formatLinkedRooms(rooms) {
  return `linked_rooms: [${rooms.map((room) => `'${room}'`).join(', ')}]`;
}

function setLinkedRooms(raw, rooms) {
  const line = formatLinkedRooms(rooms);
  if (/^linked_rooms:\s*\[[^\]]*\]\s*$/m.test(raw)) return raw.replace(/^linked_rooms:\s*\[[^\]]*\]\s*$/m, line);
  if (raw.startsWith('---\n')) return raw.replace(/^---\n/, `---\n${line}\n`);
  return `---\n${line}\n---\n${raw}`;
}

async function runVault(args, runtime, CliInputError) {
  const [subcommand, ...rest] = args;
  const { flags } = parseFlags(rest, CliInputError);
  if (subcommand === 'set') {
    const path = requireFlag(flags, 'path', CliInputError);
    writePersistedMemoryVaultPath(path);
    runtime.writeOut(`Memory pack root set to ${path.trim()}`);
    return 0;
  }
  if (subcommand === 'get') {
    const envPath = process.env.ANT_MEMORY_VAULT_PATH?.trim() || null;
    const persistedPath = readPersistedMemoryVaultPath();
    const resolvedPath = configuredMemoryPackRoot(runtime);
    if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ resolvedPath, envPath, persistedPath }));
    else {
      runtime.writeOut(`resolved\t${resolvedPath ?? '(unset)'}`);
      runtime.writeOut(`env\t${envPath ?? '(unset)'}`);
      runtime.writeOut(`persisted\t${persistedPath ?? '(unset)'}`);
    }
    return resolvedPath ? 0 : 1;
  }
  if (subcommand === 'clear') {
    writePersistedMemoryVaultPath(null);
    runtime.writeOut('Memory pack root cleared');
    return 0;
  }
  throw new CliInputError('memory vault needs set|get|clear');
}

async function runRecall(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const memLocation = resolveMemoryLocation(flags, runtime, CliInputError);
  const entries = findMemoryPackEntries(memLocation);
  const query = flags.search?.toLowerCase();
  const memID = flags.memID;
  const matches = entries.filter((entry) => {
    if (memID) return entry.memoryId === memID || entry.relativePath === memID || entry.relativePath === `${memID}.md`;
    if (query) return entry.searchableText.includes(query);
    return true;
  });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ memories: matches.map(({ memoryId, title, relativePath, filePath }) => ({ memoryId, title, relativePath, filePath })) }));
  else for (const memory of matches) runtime.writeOut(`${memory.memoryId}\t${memory.title}\t${memory.relativePath}`);
  return matches.length > 0 ? 0 : 1;
}

async function runAttachExisting(args, runtime, CliInputError, mode) {
  const { flags } = parseFlags(args, CliInputError);
  const memLocation = resolveMemoryLocation(flags, runtime, CliInputError);
  const memID = requireFlag(flags, 'memID', CliInputError);
  const useAllRooms = flags['all-rooms'] !== undefined;
  if (mode === 'remove' && useAllRooms) throw new CliInputError('memory remove does not support --all-rooms; pass --roomID');
  if (useAllRooms && flags.roomID !== undefined) throw new CliInputError('use only one of --roomID or --all-rooms');
  if (!useAllRooms && flags.roomID === undefined) throw new CliInputError('memory command needs --roomID VALUE or --all-rooms');
  let roomIds;
  if (useAllRooms) {
    const sendJson = makeStandardSendJson(runtime);
    const result = await sendJson(pathWithPidChain('/api/chat-rooms'), 'GET');
    roomIds = (result.chatRooms ?? result.rooms ?? []).map((room) => room.id).filter(Boolean);
  } else {
    roomIds = [flags.roomID];
  }
  const memory = findMemoryById(memLocation, memID, CliInputError);
  const existingRooms = parseLinkedRooms(memory.raw);
  const nextRooms = mode === 'add' ? Array.from(new Set([...existingRooms, ...roomIds])) : existingRooms.filter((room) => !roomIds.includes(room));
  writeFileSync(memory.filePath, setLinkedRooms(memory.raw, nextRooms), 'utf-8');
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ memoryId: memory.memoryId, roomIds, linkedRooms: nextRooms }));
  else {
    const target = useAllRooms ? `${roomIds.length} rooms` : roomIds[0];
    runtime.writeOut(`${mode === 'add' ? 'Attached' : 'Removed'} ${memory.memoryId} ${mode === 'add' ? 'to' : 'from'} ${target}`);
  }
  return 0;
}

function formatMemoryLine(memory) {
  const scope = memory.scope ?? 'global';
  const target = memory.scopeTarget ? `:${memory.scopeTarget}` : '';
  return `${memory.key}\t[${scope}${target}]\t${memory.value}`;
}

async function runGet(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory get needs a key');
  const sendJson = makeStandardSendJson(runtime);
  const path = pathWithPidChain(`/api/memories/key/${key.split('/').map(encodeURIComponent).join('/')}`);
  try {
    const result = await sendJson(path, 'GET');
    if (flags.json !== undefined) runtime.writeOut(JSON.stringify(result));
    else runtime.writeOut(formatMemoryLine(result.memory));
    return 0;
  } catch (cause) {
    const message = cause?.message ?? String(cause);
    if (message.includes('404')) {
      runtime.writeOut(`(no memory at ${key})`);
      return 1;
    }
    throw cause;
  }
}

async function runPut(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory put needs a key');
  const value = flags.value;
  if (typeof value !== 'string') throw new CliInputError('memory put needs --value TEXT');
  const result = await makeStandardSendJson(runtime)('/api/memories', 'POST', {
    key,
    value,
    scope: flags.scope ?? 'global',
    scope_target: flags.target ?? null,
    byHandle: flags.by ?? null,
    pidChain: processIdentityChain()
  });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(result));
  else runtime.writeOut(`${result.created ? 'Created' : 'Updated'} memory ${result.memory.key}`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const exclusiveCount = (flags.prefix !== undefined ? 1 : 0) + (flags.terminal !== undefined ? 1 : 0) + (flags.room !== undefined ? 1 : 0);
  if (exclusiveCount > 1) throw new CliInputError('use only one of --prefix, --terminal, --room');
  const sendJson = makeStandardSendJson(runtime);
  let result;
  if (flags.terminal !== undefined) {
    const terminal = await resolveTerminalIdentifier(runtime, flags.terminal, CliInputError);
    result = await sendJson(`/api/terminals/${encodeURIComponent(terminal.sessionId)}/memories`, 'GET');
  } else if (flags.room !== undefined) {
    const room = await resolveChatRoomIdentifier(runtime, flags.room, CliInputError);
    result = await sendJson(pathWithPidChain(`/api/memories?scope=room&target=${encodeURIComponent(room.id)}`), 'GET');
  } else {
    result = await sendJson(pathWithPidChain(`/api/memories${flags.prefix !== undefined ? `?prefix=${encodeURIComponent(flags.prefix)}` : ''}`), 'GET');
  }
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(result));
  else for (const memory of result.memories ?? []) runtime.writeOut(formatMemoryLine(memory));
  return 0;
}

async function runDelete(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const key = positionals[0];
  if (!key) throw new CliInputError('memory delete needs a key');
  const path = pathWithPidChain(`/api/memories/key/${key.split('/').map(encodeURIComponent).join('/')}${flags.by ? `?byHandle=${encodeURIComponent(flags.by)}` : ''}`);
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, { method: 'DELETE' });
  if (response.status === 204) {
    if (flags.json !== undefined) runtime.writeOut(JSON.stringify({ deleted: true, key }));
    else runtime.writeOut(`Deleted ${key}`);
    return 0;
  }
  if (response.status === 404) {
    runtime.writeOut(`(no memory at ${key})`);
    return 1;
  }
  const text = await response.text().catch(() => '');
  throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
}

async function runAudit(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const params = new URLSearchParams();
  if (flags.key) params.set('key', flags.key);
  if (flags.limit) params.set('limit', flags.limit);
  const query = params.toString();
  const result = await makeStandardSendJson(runtime)(pathWithPidChain(`/api/memories/audit${query ? `?${query}` : ''}`), 'GET');
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(result));
  else {
    for (const row of result.audit ?? []) {
      runtime.writeOut(`${new Date(row.atMs).toISOString()}\t${row.action}\t${row.memoryKey}\t${row.byHandle ?? '-'}`);
    }
  }
  return 0;
}

export async function handleMemoryVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'vault': return runVault(args, runtime, CliInputError);
    case 'recall': return runRecall(args, runtime, CliInputError);
    case 'add': return runAttachExisting(args, runtime, CliInputError, 'add');
    case 'remove': return runAttachExisting(args, runtime, CliInputError, 'remove');
    case 'get': return runGet(args, runtime, CliInputError);
    case 'put': return runPut(args, runtime, CliInputError);
    case 'list': return runList(args, runtime, CliInputError);
    case 'delete': return runDelete(args, runtime, CliInputError);
    case 'audit': return runAudit(args, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown memory verb: ${action}`);
}
