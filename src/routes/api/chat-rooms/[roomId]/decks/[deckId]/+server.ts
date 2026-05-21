/**
 * GET /api/chat-rooms/:roomId/decks/:deckId
 *   Returns the deck rendered as text/html. The /artefacts/[id] page
 *   iframes this URL, so this endpoint IS the viewer surface.
 *   Slide separator: a markdown horizontal rule (`---` on its own line).
 *
 * PUT /api/chat-rooms/:roomId/decks/:deckId
 *   Upserts the deck body. JSON: { contentFormat, contentBody, artefactId,
 *   updatedByHandle? }. contentFormat must be 'markdown' (univer-json is
 *   forward-reserved). The artefactId binds the body to a chat_room_artefacts
 *   row — the URL `:deckId` is the body's own id (per artefact_content.id).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getArtefact } from '$lib/server/chatRoomArtefactStore';
import {
  getArtefactContentById,
  upsertArtefactContent,
  type ArtefactContentFormat
} from '$lib/server/chatRoomArtefactContentStore';
import { renderMarkdown } from '$lib/chat/renderMarkdown';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

const SLIDE_SEPARATOR_RE = /^\s*-{3,}\s*$/m;

function splitIntoSlides(markdownBody: string): string[] {
  const lines = markdownBody.split('\n');
  const slides: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (SLIDE_SEPARATOR_RE.test(line)) {
      slides.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  slides.push(current.join('\n').trim());
  return slides.filter((slide) => slide.length > 0);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDeckHtml(title: string, markdownBody: string): string {
  const slides = splitIntoSlides(markdownBody);
  const slideHtml = slides
    .map(
      (slide, index) =>
        `<section class="slide" aria-label="Slide ${index + 1} of ${slides.length}">
          <div class="slide-body">${renderMarkdown(slide)}</div>
          <footer class="slide-footer"><span>${index + 1} / ${slides.length}</span></footer>
        </section>`
    )
    .join('\n');
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; --bg: #fff7ed; --ink: #1f2937; --soft: #6b7280; --line: #e5e7eb; --accent: #d97706; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #1c1917; --ink: #f5f5f4; --soft: #a8a29e; --line: #44403c; --accent: #fbbf24; }
    }
    html, body { background: var(--bg); color: var(--ink); margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .deck-wrap { display: flex; flex-direction: column; gap: 1.5rem; padding: 1.5rem; max-width: 64rem; margin: 0 auto; }
    .slide { aspect-ratio: 16 / 9; padding: 2.5rem 3rem; background: var(--bg); border: 1px solid var(--line); border-radius: 0.85rem; box-shadow: 0 6px 24px rgba(0,0,0,0.08); display: flex; flex-direction: column; }
    .slide-body { flex: 1; overflow: auto; }
    .slide-body h1 { margin-top: 0; font-size: 2.1rem; color: var(--ink); }
    .slide-body h2 { font-size: 1.5rem; color: var(--ink); }
    .slide-body h3 { font-size: 1.15rem; color: var(--soft); }
    .slide-body p, .slide-body li { font-size: 1.05rem; line-height: 1.55; color: var(--ink); }
    .slide-body code { background: rgba(0,0,0,0.06); padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.92em; }
    .slide-body pre { background: rgba(0,0,0,0.06); padding: 0.75rem 0.9rem; border-radius: 0.45rem; overflow-x: auto; font-size: 0.92rem; }
    .slide-body pre code { background: none; padding: 0; }
    .slide-body table { border-collapse: collapse; width: 100%; font-size: 0.94rem; }
    .slide-body th, .slide-body td { border: 1px solid var(--line); padding: 0.45rem 0.7rem; text-align: left; }
    .slide-footer { display: flex; justify-content: flex-end; padding-top: 0.85rem; color: var(--soft); font-size: 0.78rem; }
    @media print {
      .slide { box-shadow: none; page-break-after: always; border: none; }
      .deck-wrap { gap: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="deck-wrap" aria-label="Deck: ${safeTitle}">
    ${slideHtml}
  </main>
</body>
</html>`;
}

export const GET: RequestHandler = ({ params }) => {
  const { roomId, deckId } = params;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  const content = getArtefactContentById(deckId);
  if (!content) throw error(404, 'Deck content not found.');
  if (content.roomId !== roomId) throw error(404, 'Deck not in this room.');
  if (content.kind !== 'deck') throw error(400, 'Artefact is not a deck.');
  const artefact = getArtefact(content.artefactId);
  const title = artefact?.title ?? 'Deck';
  if (content.contentFormat === 'univer-json') {
    throw error(501, 'Univer-rendered decks not yet implemented in the read endpoint.');
  }
  return new Response(renderDeckHtml(title, content.contentBody), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { roomId, deckId } = params;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | { artefactId?: unknown; contentFormat?: unknown; contentBody?: unknown; updatedByHandle?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate deck-content PUT.
  requireChatRoomMutationAuth(roomId, request, payload);
  if (typeof payload.artefactId !== 'string' || payload.artefactId.length === 0) {
    throw error(400, 'artefactId is required.');
  }
  if (payload.contentFormat !== 'markdown' && payload.contentFormat !== 'univer-json') {
    throw error(400, 'contentFormat must be "markdown" or "univer-json".');
  }
  if (typeof payload.contentBody !== 'string') {
    throw error(400, 'contentBody must be a string.');
  }
  const artefact = getArtefact(payload.artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');
  if (artefact.roomId !== roomId) throw error(400, 'Artefact does not belong to this room.');
  if (artefact.kind !== 'deck') throw error(400, 'Artefact is not a deck.');
  const persisted = upsertArtefactContent({
    id: deckId,
    artefactId: payload.artefactId,
    roomId,
    kind: 'deck',
    contentFormat: payload.contentFormat as ArtefactContentFormat,
    contentBody: payload.contentBody,
    updatedByHandle:
      typeof payload.updatedByHandle === 'string' ? payload.updatedByHandle : null
  });
  return json(persisted, { status: 200 });
};
