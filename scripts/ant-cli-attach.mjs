/**
 * ant attach — upload-a-file CLI (2026-05-22).
 *
 * Sister to `ant artefact`. Where artefacts are pointers (refUrl), attachments
 * store the actual BYTES of a file in the room. Use this when the file
 * doesn't have a stable home elsewhere and you want it durably available
 * to room members via a download URL.
 *
 * Trade-off: attachments live in chat_attachments (server memory + DB);
 * artefacts live as cheap metadata pointing at wherever the file is. For
 * existing files (built HTML on disk, deployed site, shared drive) prefer
 * `ant artefact add`. For ephemeral / generated content the agent wants
 * to share inline, use `ant attach add`.
 *
 * Verbs:
 *   ant attach add  --room <roomId> --file <path> [--mime <mimeType>]
 *     Reads the file at <path>, base64-encodes it, POSTs to the room.
 *     mime-type auto-detected from extension when --mime omitted (best-
 *     effort; falls back to application/octet-stream).
 *
 *   ant attach list --room <roomId> [--json]
 *
 * 9-year-old-readable. Stay under 260 lines.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { makeStandardSendJson } from './ant-cli-shared-resolve.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

// Literal --room id (no name-lookup) — same reasoning as ant-cli-artefact.

const BOOLEAN_FLAGS = new Set(['json']);

const MIME_BY_EXT = {
  '.html': 'text/html',
  '.htm':  'text/html',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.json': 'application/json',
  '.csv':  'text/csv',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.pdf':  'application/pdf',
  '.zip':  'application/zip'
};

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
  runtime.writeOut('ant attach <add|list>');
  runtime.writeOut('  attach add  --room <id> --file <path> [--mime <mimeType>]');
  runtime.writeOut('  attach list --room <id> [--json]');
}

function callerHandle(runtime) {
  return runtime.config?.callerHandle ?? '@you';
}

function mimeForPath(path, override) {
  if (override && override.length > 0) return override;
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

async function runAdd(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags.room) throw new CliInputError('attach add needs --room <id>');
  if (!flags.file) throw new CliInputError('attach add needs --file <path>');
  const absPath = resolve(flags.file);
  let stats;
  try { stats = statSync(absPath); }
  catch { throw new CliInputError(`cannot read file at ${absPath}`); }
  if (!stats.isFile()) throw new CliInputError(`${absPath} is not a regular file`);
  // 8 MiB ceiling matches the server's chatAttachmentStore validator; checking
  // here avoids reading + base64-encoding a too-big file just to be rejected.
  const MAX_BYTES = 8 * 1024 * 1024;
  if (stats.size > MAX_BYTES) {
    throw new CliInputError(`file is ${stats.size} bytes; max 8 MiB. Use \`ant artefact add\` for larger files.`);
  }

  const contentsBase64 = readFileSync(absPath).toString('base64');
  const filename = basename(absPath);
  const mimeType = mimeForPath(absPath, flags.mime);

  const room = { id: flags.room.trim() };
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/chat-rooms/${encodeURIComponent(room.id)}/attachments`, 'POST', {
    pidChain: processIdentityChain(),
    filename,
    mimeType,
    contentsBase64,
    uploadedByHandle: callerHandle(runtime)
  });
  const shared = result?.sharedFile ?? result;
  runtime.writeOut(`uploaded ${filename}  [${mimeType}, ${stats.size}B]  id=${shared?.id ?? '(unknown)'}`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags.room) throw new CliInputError('attach list needs --room <id>');
  const room = { id: flags.room.trim() };
  const pidChain = encodeURIComponent(JSON.stringify(processIdentityChain()));
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/chat-rooms/${encodeURIComponent(room.id)}/attachments?pidChain=${pidChain}`,
    'GET'
  );
  const files = result?.sharedFiles ?? result?.attachments ?? [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(files, null, 2));
    return 0;
  }
  if (files.length === 0) {
    runtime.writeOut('(no attachments in this room)');
    return 0;
  }
  for (const f of files) {
    runtime.writeOut(`${f.id}  ${f.filename ?? '?'}  [${f.mimeType ?? '?'}]  ${f.uploadedByHandle ?? ''}`);
  }
  return 0;
}

export async function handleAttachVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  switch (action) {
    case 'add':  return runAdd(args, runtime, CliInputError);
    case 'list': return runList(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown attach verb: ${action}`);
  }
}
