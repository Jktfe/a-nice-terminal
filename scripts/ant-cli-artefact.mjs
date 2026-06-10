/**
 * ant artefact — reference-an-artefact CLI (2026-05-22).
 *
 * Artefacts are POINTERS to first-class objects living in a room — HTML
 * files, decks, ANT Stage presentations, spreadsheets, docs, mockups,
 * trackers. The file/object stays where
 * it lives; the room gets a card with title + refUrl + summary so
 * members can see + click through.
 *
 * For actually uploading file BYTES into the room, use `ant attach` —
 * that path stores the contents in chat_attachments and exposes a
 * download URL. Artefacts are cheaper (metadata only) and the right
 * default for files that already have a home (filesystem, deployed site,
 * shared drive, etc).
 *
 * Verbs:
 *   ant artefact add --room <roomId> --kind <kind> --title "..."
 *                    --ref-url file:///path [--summary "..."]
 *     One of: html | deck | stage | spreadsheet | doc | mockup | tracker | other.
 *     For a normal built deck, use --kind deck --ref-url /d/<slug>.
 *     For an ANT Stage presentation, use --kind stage --ref-url /decks/<deckId>?password=...
 *
 *   ant artefact list --room <roomId> [--json]
 *
 *   ant artefact remove --room <roomId> <artefactId>
 *
 * 9-year-old-readable. Stay under 260 lines.
 */

import { makeStandardSendJson } from './ant-cli-shared-resolve.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

// Use the --room value LITERALLY (no name-resolution lookup). The name-
// resolution path calls GET /api/chat-rooms which 401s without browser-
// session/admin auth; agents have their room id already. Matches the
// `ant chat send` pattern (also literal-id only).

const BOOLEAN_FLAGS = new Set(['json']);
const VALID_KINDS = new Set(['html', 'deck', 'stage', 'spreadsheet', 'doc', 'mockup', 'tracker', 'other']);

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
  runtime.writeOut('ant artefact <add|list|remove>');
  runtime.writeOut('  artefact add    --room <id> --kind <html|deck|stage|spreadsheet|doc|mockup|tracker|other>');
  runtime.writeOut('                  --title "..." --ref-url <url-or-path> [--summary "..."]');
  runtime.writeOut('                  normal deck: --kind deck --ref-url /d/SLUG');
  runtime.writeOut('                  Stage presentation: --kind stage --ref-url /decks/DECK_ID?password=...');
  runtime.writeOut('                  tracker: --kind tracker --ref-url /rooms/ROOM_ID/trackers/TRACKER_ID');
  runtime.writeOut('  artefact list   --room <id> [--json]');
  runtime.writeOut('  artefact remove --room <id> <artefactId>');
}

async function runAdd(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags.room) throw new CliInputError('artefact add needs --room <id>');
  if (!flags.kind) throw new CliInputError('artefact add needs --kind <html|deck|stage|spreadsheet|doc|mockup|tracker|other>');
  if (!VALID_KINDS.has(flags.kind)) {
    throw new CliInputError(`--kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  }
  if (!flags.title) throw new CliInputError('artefact add needs --title "..."');
  if (!flags['ref-url']) throw new CliInputError('artefact add needs --ref-url <url-or-path>');

  const room = { id: flags.room.trim() };
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/chat-rooms/${encodeURIComponent(room.id)}/artefacts`, 'POST', {
    pidChain: processIdentityChain(),
    kind: flags.kind,
    title: flags.title,
    refUrl: flags['ref-url'],
    summary: flags.summary ?? null
  });
  runtime.writeOut(`added artefact ${result?.id ?? '(unknown)'} → ${room.id}  [${flags.kind}]  ${flags.title}`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  if (!flags.room) throw new CliInputError('artefact list needs --room <id>');
  const room = { id: flags.room.trim() };
  const pidChain = encodeURIComponent(JSON.stringify(processIdentityChain()));
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(
    `/api/chat-rooms/${encodeURIComponent(room.id)}/artefacts?pidChain=${pidChain}`,
    'GET'
  );
  const artefacts = result?.artefacts ?? [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(artefacts, null, 2));
    return 0;
  }
  if (artefacts.length === 0) {
    runtime.writeOut('(no artefacts in this room)');
    return 0;
  }
  for (const a of artefacts) {
    runtime.writeOut(`${a.id}  [${a.kind}]  ${a.title}${a.refUrl ? '  → ' + a.refUrl : ''}`);
  }
  return 0;
}

async function runRemove(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  if (!flags.room) throw new CliInputError('artefact remove needs --room <id>');
  const artefactId = positionals[0];
  if (!artefactId) throw new CliInputError('artefact remove needs an artefactId');
  const room = { id: flags.room.trim() };
  const sendJson = makeStandardSendJson(runtime);
  await sendJson(
    `/api/chat-rooms/${encodeURIComponent(room.id)}/artefacts?artefactId=${encodeURIComponent(artefactId)}`,
    'DELETE',
    { pidChain: processIdentityChain() }
  );
  runtime.writeOut(`removed ${artefactId}`);
  return 0;
}

export async function handleArtefactVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  switch (action) {
    case 'add':    return runAdd(args, runtime, CliInputError);
    case 'list':   return runList(args, runtime, CliInputError);
    case 'remove': return runRemove(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown artefact verb: ${action}`);
  }
}
