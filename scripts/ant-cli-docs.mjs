/**
 * ant docs — Generate manifest-derived docs + room-scoped markdown doc CRUD.
 *
 * Verbs:
 *   ant docs generate --from-cli [--out-dir DIR] [--filename NAME]
 *   ant docs list --room ROOM_ID [--json]
 *   ant docs add --room ROOM_ID --title TITLE [--content TEXT] [--json]
 *   ant docs update --room ROOM_ID --id DOC_ID [--title TEXT] [--content TEXT] [--json]
 *   ant docs remove --room ROOM_ID --id DOC_ID [--json]
 *
 * generate: Fetches the canonical markdown from /discover.md.
 * list/add/update/remove: Room-scoped markdown doc management (Task #124).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BOOLEAN_FLAGS = new Set(['from-cli', 'json']);
const DEFAULT_OUT_DIR = './docs';
const DEFAULT_FILENAME = 'cli-discovery.md';

export async function handleDocsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'generate': return runGenerate(flags, runtime, CliInputError);
    case 'list': return runList(flags, runtime, CliInputError);
    case 'add': return runAdd(flags, runtime, CliInputError);
    case 'update': return runUpdate(flags, runtime, CliInputError);
    case 'remove': return runRemove(flags, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown docs verb: ${action}`);
  }
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
  runtime.writeOut('ant docs generate --from-cli [--out-dir DIR] [--filename NAME]');
  runtime.writeOut('ant docs list --room ROOM_ID [--json]');
  runtime.writeOut('ant docs add --room ROOM_ID --title TITLE [--content TEXT] [--json]');
  runtime.writeOut('ant docs update --room ROOM_ID --id DOC_ID [--title TEXT] [--content TEXT] [--json]');
  runtime.writeOut('ant docs remove --room ROOM_ID --id DOC_ID [--json]');
}

function assertSafeFilename(filename, CliInputError) {
  if (filename.length === 0) throw new CliInputError('--filename must not be empty');
  if (filename.includes('/') || filename.includes('\\')) {
    throw new CliInputError('--filename must be a bare filename (no path separators)');
  }
  if (filename === '.' || filename === '..' || filename.includes('..')) {
    throw new CliInputError('--filename must not contain ".."');
  }
}

async function runGenerate(flags, runtime, CliInputError) {
  if (flags['from-cli'] !== 'true') {
    throw new CliInputError('docs generate needs --from-cli (the canonical source flag).');
  }
  const outDir = flags['out-dir'] ?? DEFAULT_OUT_DIR;
  const filename = flags.filename ?? DEFAULT_FILENAME;
  assertSafeFilename(filename, CliInputError);
  const url = `${runtime.serverUrl}/discover.md`;

  const response = await runtime.fetchImpl(url);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`docs fetch failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const markdownBody = await response.text();

  const resolvedDir = resolve(outDir);
  const resolvedPath = join(resolvedDir, filename);
  await mkdir(resolvedDir, { recursive: true });
  await writeFile(resolvedPath, markdownBody, 'utf8');
  runtime.writeOut(resolvedPath);
  return 0;
}

async function runList(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for docs list.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/docs`;
  const response = await runtime.fetchImpl(url);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`docs list failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const body = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(body.docs));
    return 0;
  }

  if (!body.docs || body.docs.length === 0) {
    runtime.writeOut('No docs in this room.');
    return 0;
  }

  for (const doc of body.docs) {
    runtime.writeOut(`${doc.id}  ${doc.title}`);
  }
  return 0;
}

async function runAdd(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for docs add.');
  const title = flags.title;
  if (!title) throw new CliInputError('--title is required for docs add.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/docs`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content: flags.content ?? '',
      createdBy: runtime.handle ?? null
    })
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`docs add failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const doc = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(doc));
  } else {
    runtime.writeOut(`Created doc: ${doc.id} — ${doc.title}`);
  }
  return 0;
}

async function runUpdate(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for docs update.');
  const docId = flags.id;
  if (!docId) throw new CliInputError('--id is required for docs update.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/docs?docId=${encodeURIComponent(docId)}`;
  const body = {};
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.content !== undefined) body.content = flags.content;

  const response = await runtime.fetchImpl(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`docs update failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const doc = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(doc));
  } else {
    runtime.writeOut(`Updated doc: ${doc.id} — ${doc.title}`);
  }
  return 0;
}

async function runRemove(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for docs remove.');
  const docId = flags.id;
  if (!docId) throw new CliInputError('--id is required for docs remove.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/docs?docId=${encodeURIComponent(docId)}`;
  const response = await runtime.fetchImpl(url, { method: 'DELETE' });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`docs remove failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify({ removed: true, id: docId }));
  } else {
    runtime.writeOut(`Removed doc: ${docId}`);
  }
  return 0;
}
