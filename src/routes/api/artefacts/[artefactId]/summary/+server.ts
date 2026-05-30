/**
 * GET /api/artefacts/:artefactId/summary
 *
 * Lightweight metadata payload for the native-app artefact card
 * (antios + antchat per eiw05zdurz contract 2026-05-27). Returns:
 *
 *   {
 *     id, title, kind, refUrl, summary, createdBy,
 *     createdAtMs, updatedAtMs?, status?,
 *     renderTarget: 'native-browser' | 'in-app',
 *     stage?: { deckId } | null
 *   }
 *
 * renderTarget derivation (server-side truth, no client URL-pattern guessing
 * per @antioscodex's explicit-not-inferred critique):
 *   - kind === 'deck' AND refUrl resolves to a real chat_room_decks row
 *     (i.e. URL of shape /decks/<deckId>) → 'in-app' + stage.deckId
 *   - otherwise → 'native-browser'
 *
 * status (only set for kind='deck' with a /d/<slug> Animotion ref):
 *   - 'built' when <root>/<slug>/dist/index.html exists in any configured root
 *   - 'unbuilt' otherwise
 *
 * Auth: caller must be able to read the artefact's room. The endpoint
 * resolves the room via the artefact row + delegates to
 * requireChatRoomReadAccess.
 *
 * Heavy Stage playback config (voice, audio cache URL, path-mutation
 * schema) lives at GET /api/decks/:deckId/stage-config — fetched only
 * when the client actually mounts the Stage view.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getArtefact } from '$lib/server/chatRoomArtefactStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { getDeck } from '$lib/server/deckStore';
import { deckRootsResolved } from '$lib/server/deckSettingsStore';

const DECKS_URL_PATTERN = /^\/decks\/([a-zA-Z0-9_-]+)/;
const D_SLUG_URL_PATTERN = /^\/d\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)/;

type SummaryPayload = {
  id: string;
  title: string;
  kind: string;
  refUrl: string | null;
  summary: string | null;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs?: number;
  status?: 'built' | 'unbuilt';
  renderTarget: 'native-browser' | 'in-app';
  stage: { deckId: string } | null;
};

function extractDeckIdFromRefUrl(refUrl: string | null): string | null {
  if (!refUrl) return null;
  const match = refUrl.match(DECKS_URL_PATTERN);
  return match ? match[1] : null;
}

function extractAnimotionSlugFromRefUrl(refUrl: string | null): string | null {
  if (!refUrl) return null;
  const match = refUrl.match(D_SLUG_URL_PATTERN);
  return match ? match[1] : null;
}

/**
 * Decide if an artefact should render in-app. The signal is a verified
 * Stage deck row in chat_room_decks, NOT a URL pattern — clients
 * consume `renderTarget` directly without inspecting the URL.
 */
function deriveRenderTarget(artefactKind: string, refUrl: string | null): {
  renderTarget: 'native-browser' | 'in-app';
  stageDeckId: string | null;
} {
  if (artefactKind !== 'deck') return { renderTarget: 'native-browser', stageDeckId: null };
  const candidateDeckId = extractDeckIdFromRefUrl(refUrl);
  if (!candidateDeckId) return { renderTarget: 'native-browser', stageDeckId: null };
  const deck = getDeck(candidateDeckId);
  if (!deck) {
    // Path matched /decks/<id> but no real deck row — degrade to
    // browser (safer than asserting in-app for a dead link).
    return { renderTarget: 'native-browser', stageDeckId: null };
  }
  return { renderTarget: 'in-app', stageDeckId: deck.id };
}

/**
 * For kind=deck artefacts with /d/<slug> refUrl, check whether the
 * built deck exists on disk under any configured root. 'built' if the
 * dist/index.html is present in at least one root; 'unbuilt' otherwise.
 * Returns undefined for non-Animotion artefacts (status doesn't apply).
 */
function deriveDeckStatus(artefactKind: string, refUrl: string | null): 'built' | 'unbuilt' | undefined {
  if (artefactKind !== 'deck') return undefined;
  const slug = extractAnimotionSlugFromRefUrl(refUrl);
  if (!slug) return undefined;
  const roots = deckRootsResolved();
  for (const root of roots) {
    if (existsSync(join(root, slug, 'dist', 'index.html'))) return 'built';
  }
  return 'unbuilt';
}

export const GET: RequestHandler = async ({ params, request }) => {
  const artefactId = params.artefactId ?? '';
  if (artefactId.length === 0) throw error(400, 'artefactId required.');

  const artefact = getArtefact(artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');

  const room = findChatRoomById(artefact.roomId);
  if (!room) throw error(404, 'Artefact room not found.');

  // Same gate as room message reads — caller must be able to see the
  // room to read its artefact summaries.
  await requireChatRoomReadAccess(request, room);

  const { renderTarget, stageDeckId } = deriveRenderTarget(artefact.kind, artefact.refUrl);
  const status = deriveDeckStatus(artefact.kind, artefact.refUrl);

  const payload: SummaryPayload = {
    id: artefact.id,
    title: artefact.title,
    kind: artefact.kind,
    refUrl: artefact.refUrl,
    summary: artefact.summary,
    createdBy: artefact.createdBy,
    createdAtMs: artefact.createdAtMs,
    renderTarget,
    stage: stageDeckId ? { deckId: stageDeckId } : null
  };
  if (status !== undefined) payload.status = status;

  return json(payload);
};
