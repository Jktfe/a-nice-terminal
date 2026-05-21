/**
 * POST /api/terminals/[id]/resize  body { cols: number, rows: number }
 *   Resizes the daemon's tmux pane. Per terminals-backend-design-contract
 *   2026-05-14 Q1 frontend ack: xterm fit-addon → POST /resize after mount.
 *   Fire-and-forget (daemon protocol has no resize ack).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resizeTerminal } from '$lib/server/ptyClient';

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  const cols = typeof raw?.cols === 'number' && Number.isFinite(raw.cols) ? raw.cols : null;
  const rows = typeof raw?.rows === 'number' && Number.isFinite(raw.rows) ? raw.rows : null;
  if (cols === null || rows === null) throw error(400, 'cols and rows must be finite numbers.');
  resizeTerminal(sessionId, cols, rows);
  return json({ ok: true }, { status: 202 });
};
