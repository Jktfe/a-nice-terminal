/**
 * POST /api/terminals/[id]/input  body { data: string }
 *   Writes input bytes/string to the daemon for the given sessionId.
 *   Per terminals-backend-design-contract 2026-05-14 Q3 (per-key POST v1).
 *
 * Returns 202 Accepted (fire-and-forget; daemon protocol has no ack for write).
 *
 * Auth: admin-bearer OR browser-session resolved to terminal owner/co-owner
 * or explicit read_write grant.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeInput } from '$lib/server/ptyClient';
import { requireTerminalInputWriteAccess } from '$lib/server/terminalWriteAccessGate';

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  requireTerminalInputWriteAccess(request, sessionId);
  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  const data = typeof raw?.data === 'string' ? (raw.data as string) : null;
  if (data === null) throw error(400, 'body.data must be a string.');
  writeInput(sessionId, data);
  return json({ ok: true }, { status: 202 });
};
