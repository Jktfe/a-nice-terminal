import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { fileGet, filePut, DECK_KIND } from '../lib/artefact-files.js';

function roomOpts(flags: any): { roomToken?: string } | undefined {
  const roomId = flags.session || flags.room || flags.session_id;
  if (!roomId) return undefined;
  const token = config.getRoomToken(String(roomId));
  return token?.token ? { roomToken: token.token } : undefined;
}

function fileCount(manifest: any): number {
  return Array.isArray(manifest?.files) ? manifest.files.length : 0;
}

function printDeckRow(deck: any, manifest?: any) {
  const rooms = Array.isArray(deck.allowed_room_ids) ? deck.allowed_room_ids.length : 0;
  const port = deck.dev_port ? `:${deck.dev_port}` : '';
  const files = manifest ? `${fileCount(manifest)} files` : 'no manifest';
  console.log(`${String(deck.slug).padEnd(32)} ${String(deck.title || '').padEnd(28)} rooms=${rooms} ${files}${port}`);
}

async function listDecks(flags: any, ctx: any) {
  const data = await api.get(ctx, '/api/decks', roomOpts(flags));
  const decks = data.decks || [];
  if (ctx.json) {
    console.log(JSON.stringify(decks, null, 2));
    return;
  }
  if (!decks.length) {
    console.log('No decks.');
    return;
  }
  for (const deck of decks) printDeckRow(deck);
}

async function showDeck(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant deck status <slug> [--session <room-id>]');
  const data = await api.get(ctx, `/api/decks/${encodeURIComponent(slug)}`, roomOpts(flags));
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const deck = data.deck;
  const manifest = data.manifest;
  printDeckRow(deck, manifest);
  console.log(`Directory: ${deck.deck_dir}`);
  console.log(`Owner:     ${deck.owner_session_id}`);
  console.log(`Rooms:     ${(deck.allowed_room_ids || []).join(', ') || '(none)'}`);
  if (!manifest) {
    console.log('Manifest:  missing');
    return;
  }
  console.log(`Manifest:  ${manifest.updated_at}`);
  console.log(`Source:    ${manifest.source_session_id || '(unknown)'}`);
  if (manifest.source_evidence_hash) console.log(`Evidence:  ${manifest.source_evidence_hash}`);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const file of files.slice(0, Number(flags.limit || 12))) {
    console.log(`  ${file.sha256.slice(0, 12)} ${String(file.size).padStart(8)} ${file.path}`);
  }
  if (files.length > Number(flags.limit || 12)) {
    console.log(`  ... ${files.length - Number(flags.limit || 12)} more`);
  }
}

async function showManifest(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant deck manifest <slug> [--session <room-id>]');
  const data = await api.get(ctx, `/api/decks/${encodeURIComponent(slug)}`, roomOpts(flags));
  const manifest = data.manifest;
  if (!manifest) throw new Error('Deck manifest is missing');
  console.log(JSON.stringify(manifest, null, 2));
}

async function showAudit(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant deck audit <slug> [--limit 50] [--session <room-id>]');
  const limit = Number(flags.limit || 50);
  const data = await api.get(ctx, `/api/decks/${encodeURIComponent(slug)}/audit?limit=${encodeURIComponent(String(limit))}`, roomOpts(flags));
  const events = data.events || [];
  if (ctx.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (!events.length) {
    console.log('No deck audit events.');
    return;
  }
  for (const event of events) {
    const path = event.path ? ` ${event.path}` : '';
    const actor = event.actor ? ` ${event.actor}` : '';
    console.log(`${event.ts} ${event.type}${path}${actor}`);
  }
}

export async function deck(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    await listDecks(flags, ctx);
    return;
  }

  if (sub === 'status' || sub === 'show') {
    await showDeck(args[1], flags, ctx);
    return;
  }

  if (sub === 'manifest') {
    await showManifest(args[1], flags, ctx);
    return;
  }

  if (sub === 'audit' || sub === 'log') {
    await showAudit(args[1], flags, ctx);
    return;
  }

  // File operations — read-modify-write loop for human + agent collaboration.
  // Conflict detection via base_hash + if_match_mtime; on 409 the caller
  // re-fetches and retries (same protocol the web editor uses).
  if (sub === 'file') {
    const op = args[1];
    const slug = args[2];
    const filePath = args[3];
    const tok = roomOpts(flags);
    if (op === 'get') return fileGet(ctx, DECK_KIND, slug, filePath, flags, tok?.roomToken);
    if (op === 'put') return filePut(ctx, DECK_KIND, slug, filePath, flags, tok?.roomToken);
    throw new Error(
      `Usage:\n` +
      `  ant deck file get <slug> <path> [--out PATH] [--json] [--session <room-id>]\n` +
      `  ant deck file put <slug> <path> [--from-file LOCAL | --content "..."]\n` +
      `                     [--base-hash X --if-match-mtime N] [--session <room-id>]`,
    );
  }

  await showDeck(sub, flags, ctx);
}
