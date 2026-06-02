/**
 * POST /api/vault/[archiveId]/mine
 *
 * Stub for the memory-mining digest pass. Returns a fixed-shape preview
 * payload so the UI can demo the workflow before the real digest engine
 * ships. Production-shape lands in a follow-up commit once we decide
 * which agent runs the digest + what backend stores accepted candidates.
 *
 * Returns:
 *   { candidates: MemoryCandidate[]; status: 'stub' | 'ready' }
 *
 * MemoryCandidate = {
 *   id: string;
 *   kind: 'project' | 'feedback' | 'reference' | 'user';
 *   title: string;
 *   body: string;
 *   sourceMessageId?: string;
 *   confidence: number;  // 0..1
 * }
 *
 * The stub currently builds three placeholder candidates synthesised from
 * the archive's message count so the operator can see how the surface
 * will feel. Confidence + body wording deliberately call out their stub
 * nature.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resolveBrowserSessionSecret } from '$lib/server/browserSessionStore';
import { isSuperAdmin } from '$lib/server/orgStore';

function getCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;
    if (trimmed.slice(0, sep) === cookieName) {
      return decodeURIComponent(trimmed.slice(sep + 1));
    }
  }
  return null;
}

function requireOperatorBrowserSession(request: Request, roomId: string): void {
  const cookie = getCookieValue(request, 'ant_browser_session');
  if (!cookie) throw error(403, 'Operator browser session required.');
  const resolved = resolveBrowserSessionSecret(cookie, roomId);
  if (!resolved) throw error(403, 'Operator browser session required.');
  if (!isSuperAdmin(resolved.handle)) {
    throw error(403, 'Only the operator can mine the vault.');
  }
}

type MemoryCandidate = {
  id: string;
  kind: 'project' | 'feedback' | 'reference' | 'user';
  title: string;
  body: string;
  sourceMessageId?: string;
  confidence: number;
};

export const POST: RequestHandler = ({ params, request }) => {
  // Even though the archive is hidden from /rooms, findChatRoomById hides
  // archived rooms by default. So checking it would 404 for a valid
  // archived row. Skip the live-room existence check and look directly
  // at messages.
  const messages = listMessagesInRoom(params.archiveId);
  if (messages.length === 0) {
    throw error(404, 'Archive not found or has no mineable content.');
  }
  requireOperatorBrowserSession(request, params.archiveId);

  // STUB digest: three placeholder candidates. Production replacement
  // will run an actual LLM digest pass against the transcript + linked
  // artefacts and produce confidence-scored MemoryCandidate rows. Keeping
  // the shape stable now means the UI can wire against this contract
  // and just see better content when the engine lands.
  const earliest = messages[0];
  const latest = messages[messages.length - 1];
  const candidates: MemoryCandidate[] = [
    {
      id: `${params.archiveId}-cand-project-1`,
      kind: 'project',
      title: 'Archived session topic — placeholder',
      body:
        `The archived room spans ${messages.length} messages between ${earliest.postedAt}` +
        ` and ${latest.postedAt}. Real digest will summarise topics + decisions; this is a stub` +
        ` so the review UI works end-to-end.`,
      confidence: 0.5
    },
    {
      id: `${params.archiveId}-cand-reference-1`,
      kind: 'reference',
      title: 'External references mentioned — placeholder',
      body:
        'Real digest will extract URLs, file paths, and named tools referenced across the transcript' +
        ' and propose them as reference memories.',
      confidence: 0.4
    },
    {
      id: `${params.archiveId}-cand-feedback-1`,
      kind: 'feedback',
      title: 'JWPK-coined rules — placeholder',
      body:
        'Real digest will surface explicit corrections / confirmations / rules from operator messages' +
        ' as feedback memories so future agents inherit them.',
      confidence: 0.35
    }
  ];

  return json({ candidates, status: 'stub' as const });
};
