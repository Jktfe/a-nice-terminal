// antchat deck — Open-Slide presentation cowork from remote machines.
//
// Wraps /api/decks/* (read) and /api/decks/<slug>/files/<...path> (read +
// write) using the per-room bearer token. Marco's agent runs:
//
//   antchat deck <room> file get my-pitch slides/section-3.md   # fetch
//   # (modify locally — fill in the lawyer's name)
//   antchat deck <room> file put my-pitch slides/section-3.md \
//     --from-file /tmp/section-3.md --base-hash <from-get> --if-match-mtime <from-get>
//
// 409 conflict means another writer landed first. Re-fetch, merge, retry.
// Same protocol the web editor (D.8) uses.

import { config } from '../../cli/lib/config.js';
import { api } from '../../cli/lib/api.js';
import { fileGet, filePut, DECK_KIND } from '../../cli/lib/artefact-files.js';

interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

function resolveCallCtx(roomId: string, ctx: Ctx, flags: any): { callCtx: Ctx; roomToken: string } {
  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    if (handleFlag) {
      console.error(`antchat deck: no token for room ${roomId} under handle ${handleFlag}. Run: antchat join …`);
    } else {
      console.error(`antchat deck: no token for room ${roomId}. Run: antchat join …`);
    }
    process.exit(1);
  }
  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat deck: no server URL — pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }
  return { callCtx: { ...ctx, serverUrl }, roomToken: tok.token };
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

export async function deck(args: string[], flags: any, ctx: Ctx) {
  const roomId = args[0];
  const sub = args[1];

  if (!roomId || !sub) {
    printUsage();
    return;
  }

  const { callCtx, roomToken } = resolveCallCtx(roomId, ctx, flags);
  const opts = { roomToken };

  try {
    if (sub === 'list' || sub === 'ls') {
      const data = await api.get(callCtx, '/api/decks', opts);
      const decks = data.decks || [];
      if (callCtx.json) { console.log(JSON.stringify(decks, null, 2)); return; }
      if (!decks.length) { console.log('No decks visible to this room.'); return; }
      for (const d of decks) printDeckRow(d);
      return;
    }

    if (sub === 'status' || sub === 'show') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat deck <room> status <slug>');
      const data = await api.get(callCtx, `/api/decks/${encodeURIComponent(slug)}`, opts);
      if (callCtx.json) { console.log(JSON.stringify(data, null, 2)); return; }
      printDeckRow(data.deck, data.manifest);
      console.log(`Directory: ${data.deck.deck_dir}`);
      console.log(`Owner:     ${data.deck.owner_session_id}`);
      console.log(`Rooms:     ${(data.deck.allowed_room_ids || []).join(', ') || '(none)'}`);
      if (!data.manifest) { console.log('Manifest:  missing'); return; }
      console.log(`Manifest:  ${data.manifest.updated_at}`);
      const files = Array.isArray(data.manifest.files) ? data.manifest.files : [];
      const limit = Number(flags.limit || 12);
      for (const f of files.slice(0, limit)) {
        console.log(`  ${f.sha256.slice(0, 12)} ${String(f.size).padStart(8)} ${f.path}`);
      }
      if (files.length > limit) console.log(`  ... ${files.length - limit} more`);
      return;
    }

    if (sub === 'manifest') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat deck <room> manifest <slug>');
      const data = await api.get(callCtx, `/api/decks/${encodeURIComponent(slug)}`, opts);
      if (!data.manifest) throw new Error('Deck manifest is missing');
      console.log(JSON.stringify(data.manifest, null, 2));
      return;
    }

    if (sub === 'audit' || sub === 'log') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat deck <room> audit <slug> [--limit 50]');
      const limit = Number(flags.limit || 50);
      const data = await api.get(callCtx, `/api/decks/${encodeURIComponent(slug)}/audit?limit=${encodeURIComponent(String(limit))}`, opts);
      const events = data.events || [];
      if (callCtx.json) { console.log(JSON.stringify(events, null, 2)); return; }
      if (!events.length) { console.log('No deck audit events.'); return; }
      for (const e of events) {
        const path = e.path ? ` ${e.path}` : '';
        const actor = e.actor ? ` ${e.actor}` : '';
        console.log(`${e.ts} ${e.type}${path}${actor}`);
      }
      return;
    }

    if (sub === 'file') {
      const op = args[2];
      const slug = args[3];
      const filePath = args[4];
      if (op === 'get') return fileGet(callCtx, DECK_KIND, slug, filePath, flags, roomToken);
      if (op === 'put') return filePut(callCtx, DECK_KIND, slug, filePath, flags, roomToken);
      throw new Error(
        'Usage:\n' +
        '  antchat deck <room> file get <slug> <path> [--out PATH] [--json]\n' +
        '  antchat deck <room> file put <slug> <path> [--from-file LOCAL | --content "..."]\n' +
        '                                                [--base-hash X --if-match-mtime N]',
      );
    }

    console.error(`antchat deck: unknown subcommand "${sub}"`);
    printUsage();
    process.exit(1);
  } catch (err: any) {
    console.error(`antchat deck: ${err.message}`);
    process.exit(1);
  }
}

function printUsage() {
  console.error('Usage: antchat deck <room-id> <list|status|manifest|audit|file> [args]');
  console.error('');
  console.error('  antchat deck <room> list');
  console.error('  antchat deck <room> status <slug>');
  console.error('  antchat deck <room> manifest <slug>');
  console.error('  antchat deck <room> audit <slug> [--limit 50]');
  console.error('  antchat deck <room> file get <slug> <path> [--out PATH] [--json]');
  console.error('  antchat deck <room> file put <slug> <path> [--from-file LOCAL | --content "..."]');
  console.error('                                              [--base-hash X --if-match-mtime N]');
  console.error('');
  console.error('Read-modify-write protocol:');
  console.error('  1. file get → captures sha256 + mtime_ms (printed to stderr / --json envelope).');
  console.error('  2. Modify locally.');
  console.error('  3. file put with --base-hash + --if-match-mtime from step 1.');
  console.error('  4. On 409: re-fetch, merge, retry.');
}
