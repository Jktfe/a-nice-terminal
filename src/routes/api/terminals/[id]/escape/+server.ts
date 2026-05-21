/**
 * POST /api/terminals/[id]/escape
 *   Sends one ESC byte to the target PTY. This is the terminal/session
 *   interrupt action reserved for the 🛑 UI control; it is not a context break.
 *
 * Auth: admin-bearer OR browser-session (CVE FIX A 2026-05-19 — closes
 * security-audit-2026-05-19.md Finding #1: unauthenticated keystroke
 * injection into any tmux pane). The 🛑 button uses browser cookies so
 * resolveCallerHandleAnyRoom keeps it working.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { writeInput } from '$lib/server/ptyClient';

const ESC = '\x1b';

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
  writeInput(sessionId, ESC);
  return json({ ok: true, sessionId, sent: 'escape' }, { status: 202 });
};
