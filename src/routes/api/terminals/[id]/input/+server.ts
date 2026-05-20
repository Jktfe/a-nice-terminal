/**
 * POST /api/terminals/[id]/input  body { data: string }
 *   Writes input bytes/string to the daemon for the given sessionId.
 *   Per terminals-backend-design-contract 2026-05-14 Q3 (per-key POST v1).
 *
 * Returns 202 Accepted (fire-and-forget; daemon protocol has no ack for write).
 *
 * Auth: admin-bearer OR browser-session (CVE FIX A 2026-05-19 — closes
 * security-audit-2026-05-19.md Finding #1: unauthenticated keystroke
 * injection into any tmux pane). Mirrors the terminals/[id]/settings gate.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { writeInput } from '$lib/server/ptyClient';

function requireWriteAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required');
}

export const POST: RequestHandler = async ({ params, request }) => {
  requireWriteAuth(request);
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  const data = typeof raw?.data === 'string' ? (raw.data as string) : null;
  if (data === null) throw error(400, 'body.data must be a string.');
  writeInput(sessionId, data);
  return json({ ok: true }, { status: 202 });
};
