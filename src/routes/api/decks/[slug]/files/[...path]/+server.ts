import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { existsSync, statSync } from 'fs';
import { extname } from 'path';
import {
  DeckConflictError,
  defaultDeckDirForSlug,
  deleteDeckPath,
  deckMaxFileBytes,
  readDeckBytes,
  readDeckMeta,
  registerDeck,
  writeDeckBytes,
} from '$lib/server/decks';
import { assertDeckAccess, requireDeckCaller } from '$lib/server/deck-auth';
import { assertCanWrite } from '$lib/server/room-scope';
import { broadcast } from '$lib/server/ws-broadcast';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function pathParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).path ?? '');
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.tsx':
    case '.ts':
      return 'text/typescript; charset=utf-8';
    case '.jsx':
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function callerActor(caller: ReturnType<typeof requireDeckCaller>): string {
  if (caller.admin) return 'admin';
  return `${caller.scope.kind || 'room'}:${caller.scope.roomId}`;
}

function writeGuard(event: RequestEvent, actor: string) {
  const rawHash = event.request.headers.get('x-ant-base-hash') || event.url.searchParams.get('base_hash');
  const rawMtime = event.request.headers.get('x-ant-if-match-mtime') || event.url.searchParams.get('if_match_mtime');
  const ifMatchMtime = rawMtime == null || rawMtime === '' ? null : Number(rawMtime);
  return {
    base_hash: rawHash || null,
    if_match_mtime: Number.isFinite(ifMatchMtime) ? ifMatchMtime : null,
    actor,
  };
}

function broadcastDeckEvent(deck: NonNullable<ReturnType<typeof readDeckMeta>>, payload: Record<string, unknown>) {
  for (const roomId of deck.allowed_room_ids) {
    broadcast(roomId, {
      type: 'deck_updated',
      deck_slug: deck.slug,
      ...payload,
    });
  }
}

function mapDeckError(err: unknown): never {
  if (err instanceof DeckConflictError) throw error(409, err.message);
  const message = err instanceof Error ? err.message : String(err);
  if (/traversal|outside|invalid bytes|not editable/i.test(message)) throw error(400, message);
  if (/too large|exceeds max/i.test(message)) throw error(413, message);
  if (/not a file|ENOENT|no such file/i.test(message)) throw error(404, 'file not found');
  if (/directories/i.test(message)) throw error(400, message);
  throw error(400, message);
}

export function GET(event: RequestEvent) {
  requireDeckCaller(event);
  const deck = readDeckMeta(slugParam(event));
  if (!deck) throw error(404, 'deck not found');
  assertDeckAccess(event, deck);
  try {
    const file = readDeckBytes(deck, pathParam(event));
    return new Response(file.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType(file.path),
        'Content-Length': String(file.size),
        'Cache-Control': 'no-store',
        'ETag': `"${file.sha256}"`,
        'X-ANT-Deck-Sha256': file.sha256,
        'X-ANT-Deck-Mtime-Ms': String(file.mtime_ms),
      },
    });
  } catch (err) {
    mapDeckError(err);
  }
}

export async function PUT(event: RequestEvent) {
  const caller = requireDeckCaller(event);
  if (!caller.admin) assertCanWrite(event);

  let deck = readDeckMeta(slugParam(event));
  if (!deck) {
    if (caller.admin) throw error(404, 'deck not found');
    const deckDir = defaultDeckDirForSlug(slugParam(event));
    if (!existsSync(deckDir) || !statSync(deckDir).isDirectory()) throw error(404, 'deck not found');
    deck = registerDeck({
      slug: slugParam(event),
      owner_session_id: caller.scope.roomId,
      allowed_room_ids: [caller.scope.roomId],
      deck_dir: deckDir,
    });
  }
  assertDeckAccess(event, deck, { write: true });

  const bytes = Buffer.from(await event.request.arrayBuffer());
  if (bytes.byteLength > deckMaxFileBytes()) throw error(413, 'file exceeds max size');
  try {
    const written = writeDeckBytes(deck, pathParam(event), bytes, writeGuard(event, callerActor(caller)));
    broadcastDeckEvent(deck, {
      action: 'file_write',
      path: written.path,
      size: written.size,
      sha256: written.sha256,
    });
    return json({ ok: true, ...written });
  } catch (err) {
    mapDeckError(err);
  }
}

export function DELETE(event: RequestEvent) {
  const caller = requireDeckCaller(event);
  const deck = readDeckMeta(slugParam(event));
  if (!deck) throw error(404, 'deck not found');
  assertDeckAccess(event, deck, { write: true });
  try {
    const deleted = deleteDeckPath(deck, pathParam(event), writeGuard(event, callerActor(caller)));
    broadcastDeckEvent(deck, {
      action: 'file_delete',
      path: deleted.path,
    });
    return json({ ok: true, ...deleted });
  } catch (err) {
    mapDeckError(err);
  }
}
