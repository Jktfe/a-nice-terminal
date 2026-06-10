/**
 * GET /api/chat-rooms/:roomId/docs/:docId
 *   Returns the doc rendered as text/html. The /artefacts/[id] page
 *   iframes this URL, so this endpoint IS the viewer surface.
 *
 * PUT /api/chat-rooms/:roomId/docs/:docId
 *   Upserts the doc body. JSON: { contentFormat, contentBody, artefactId,
 *   updatedByHandle? }.
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
import { renderUniverJsonHtml } from '$lib/server/univerJsonRenderer';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDocHtml(title: string, markdownBody: string): string {
  const safeTitle = escapeHtml(title);
  const renderedBody = renderMarkdown(markdownBody);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; --bg: #fff7ed; --ink: #1f2937; --soft: #6b7280; --line: #e5e7eb; --accent: #d97706; --surface-card: rgba(255,255,255,0.6); }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #1c1917; --ink: #f5f5f4; --soft: #a8a29e; --line: #44403c; --accent: #fbbf24; --surface-card: rgba(255,255,255,0.04); }
    }
    html, body { background: var(--bg); color: var(--ink); margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; }
    .doc-wrap { max-width: 48rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
    .doc-title { font-size: 2rem; margin: 0 0 0.5rem; color: var(--ink); }
    .doc-body h1 { font-size: 1.8rem; margin-top: 2rem; }
    .doc-body h2 { font-size: 1.4rem; margin-top: 1.5rem; }
    .doc-body h3 { font-size: 1.15rem; margin-top: 1.2rem; color: var(--soft); }
    .doc-body p, .doc-body li { font-size: 1rem; color: var(--ink); }
    .doc-body code { background: var(--surface-card); padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.92em; }
    .doc-body pre { background: var(--surface-card); padding: 0.85rem 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.92rem; border: 1px solid var(--line); }
    .doc-body pre code { background: none; padding: 0; }
    .doc-body blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--accent); background: var(--surface-card); color: var(--soft); }
    .doc-body table { border-collapse: collapse; width: 100%; font-size: 0.94rem; margin: 1rem 0; }
    .doc-body th, .doc-body td { border: 1px solid var(--line); padding: 0.55rem 0.8rem; text-align: left; }
    .doc-body th { background: var(--surface-card); }
    .doc-body hr { border: 0; border-top: 1px solid var(--line); margin: 1.5rem 0; }
  </style>
</head>
<body>
  <main class="doc-wrap" aria-label="Document: ${safeTitle}">
    <h1 class="doc-title">${safeTitle}</h1>
    <article class="doc-body">${renderedBody}</article>
  </main>
</body>
</html>`;
}

export const GET: RequestHandler = ({ params }) => {
  const { roomId, docId } = params;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  const content = getArtefactContentById(docId);
  if (!content) throw error(404, 'Doc content not found.');
  if (content.roomId !== roomId) throw error(404, 'Doc not in this room.');
  if (content.kind !== 'doc') throw error(400, 'Artefact is not a doc.');
  const artefact = getArtefact(content.artefactId);
  const title = artefact?.title ?? 'Document';
  if (content.contentFormat === 'univer-json') {
    return new Response(renderUniverJsonHtml({ title, kind: 'doc', contentBody: content.contentBody }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
    });
  }
  return new Response(renderDocHtml(title, content.contentBody), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { roomId, docId } = params;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  const payload = (await request.json().catch(() => null)) as
    | { artefactId?: unknown; contentFormat?: unknown; contentBody?: unknown; updatedByHandle?: unknown }
    | null;
  if (!payload) throw error(400, 'JSON body required.');
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate doc-content PUT.
  // 2026-06-10 anti-spoof (security review): capture the auth result and use
  // the SERVER-RESOLVED handle for attribution — a caller-supplied
  // updatedByHandle was previously trusted verbatim, letting anyone attribute
  // a doc edit to any handle. Admin-bearer may still attribute on behalf of
  // another (automation path); a normal caller may only write as themselves.
  const auth = requireChatRoomMutationAuth(roomId, request, payload);
  const requestedUpdatedBy =
    typeof payload.updatedByHandle === 'string' ? payload.updatedByHandle : undefined;
  if (requestedUpdatedBy !== undefined && !auth.isAdminBearer && auth.handle !== requestedUpdatedBy) {
    throw error(403, `Caller ${auth.handle} cannot update a doc as ${requestedUpdatedBy}.`);
  }
  const updatedByHandle = requestedUpdatedBy ?? auth.handle;
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
  if (artefact.kind !== 'doc') throw error(400, 'Artefact is not a doc.');
  const persisted = upsertArtefactContent({
    id: docId,
    artefactId: payload.artefactId,
    roomId,
    kind: 'doc',
    contentFormat: payload.contentFormat as ArtefactContentFormat,
    contentBody: payload.contentBody,
    updatedByHandle
  });
  return json(persisted, { status: 200 });
};
