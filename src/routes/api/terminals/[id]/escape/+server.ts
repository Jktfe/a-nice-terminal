/**
 * POST /api/terminals/[id]/escape
 *   Sends one ESC byte to the target PTY. This is the terminal/session
 *   interrupt action reserved for the 🛑 UI control; it is not a context break.
 *
 * Auth: admin-bearer OR browser-session resolved to terminal owner/co-owner
 * or explicit read_write grant.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeInput } from '$lib/server/ptyClient';
import { requireTerminalInputWriteAccess } from '$lib/server/terminalWriteAccessGate';

const ESC = '\x1b';

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  requireTerminalInputWriteAccess(request, sessionId);
  writeInput(sessionId, ESC);
  return json({ ok: true, sessionId, sent: 'escape' }, { status: 202 });
};
