/**
 * ant decks — Room-scoped slide deck CRUD (Task #126).
 *
 *   ant decks list --room ROOM_ID [--json]
 *   ant decks add --room ROOM_ID --title TITLE [--slides-json JSON] [--theme TEXT] [--json]
 *   ant decks update --room ROOM_ID --id DECK_ID [--title TEXT] [--slides-json JSON] [--theme TEXT] [--json]
 *   ant decks remove --room ROOM_ID --id DECK_ID [--json]
 */

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleDecksVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
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
      throw new CliInputError(`unknown decks verb: ${action}`);
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
  runtime.writeOut('ant decks list --room ROOM_ID [--json]');
  runtime.writeOut('ant decks add --room ROOM_ID --title TITLE [--slides-json JSON] [--theme TEXT] [--password TEXT] [--json]');
  runtime.writeOut('ant decks update --room ROOM_ID --id DECK_ID [--title TEXT] [--slides-json JSON] [--theme TEXT] [--password TEXT] [--json]');
  runtime.writeOut('ant decks remove --room ROOM_ID --id DECK_ID [--json]');
}

async function runList(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for decks list.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/decks`;
  const response = await runtime.fetchImpl(url);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`decks list failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const body = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(body.decks));
    return 0;
  }

  if (!body.decks || body.decks.length === 0) {
    runtime.writeOut('No decks in this room.');
    return 0;
  }

  for (const deck of body.decks) {
    runtime.writeOut(`${deck.id}  ${deck.title}  (${deck.slides.length} slides)`);
  }
  return 0;
}

async function runAdd(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for decks add.');
  const title = flags.title;
  if (!title) throw new CliInputError('--title is required for decks add.');

  let slides = [];
  if (flags['slides-json']) {
    try {
      slides = JSON.parse(flags['slides-json']);
    } catch {
      throw new CliInputError('--slides-json must be valid JSON.');
    }
  }

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/decks`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      slides,
      theme: flags.theme ?? 'default',
      createdBy: runtime.handle ?? null,
      accessPassword: flags.password ?? null
    })
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`decks add failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const deck = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(deck));
  } else {
    runtime.writeOut(`Created deck: ${deck.id} — ${deck.title}`);
  }
  return 0;
}

async function runUpdate(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for decks update.');
  const deckId = flags.id;
  if (!deckId) throw new CliInputError('--id is required for decks update.');

  const body = {};
  if (flags.title !== undefined) body.title = flags.title;
  if (flags['slides-json'] !== undefined) {
    try {
      body.slides = JSON.parse(flags['slides-json']);
    } catch {
      throw new CliInputError('--slides-json must be valid JSON.');
    }
  }
  if (flags.theme !== undefined) body.theme = flags.theme;
  if (flags.password !== undefined) body.accessPassword = flags.password;

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/decks?deckId=${encodeURIComponent(deckId)}`;
  const response = await runtime.fetchImpl(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`decks update failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }
  const deck = await response.json();

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(deck));
  } else {
    runtime.writeOut(`Updated deck: ${deck.id} — ${deck.title}`);
  }
  return 0;
}

async function runRemove(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('--room is required for decks remove.');
  const deckId = flags.id;
  if (!deckId) throw new CliInputError('--id is required for decks remove.');

  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/decks?deckId=${encodeURIComponent(deckId)}`;
  const response = await runtime.fetchImpl(url, { method: 'DELETE' });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    runtime.writeErr(`decks remove failed (${response.status}): ${bodyText.slice(0, 200)}`);
    return 1;
  }

  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify({ removed: true, id: deckId }));
  } else {
    runtime.writeOut(`Removed deck: ${deckId}`);
  }
  return 0;
}
