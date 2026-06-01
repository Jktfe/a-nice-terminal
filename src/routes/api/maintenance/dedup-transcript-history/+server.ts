/**
 * POST /api/maintenance/dedup-transcript-history
 *
 * One-shot, operator-triggered historical dedup of pre-idempotency-key
 * transcript rows (NULL transcript_event_id, source='transcript') that
 * multiplied on every restart before V4-BLOCKER-B landed. Soft-deletes
 * duplicates (deleted_at_ms = now), keeps the earliest id per
 * (terminal_id, kind, text) — per JWPK SURFACE-SIZE-ONLY: soft-delete +
 * MANUAL prune, never an auto-boot/cron sweep.
 *
 * WARNING: synchronous better-sqlite3 UPDATE with a GROUP BY/NOT IN over
 * the full terminal_run_events table. On multi-GB dogfood DBs this blocks
 * the event loop for the duration — trigger it in a quiet window, not
 * during active dogfood. Idempotent: a re-run after a clean sweep is a
 * fast no-op.
 *
 * Body: {} (no params). Returns { softDeleted: number }.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { dedupHistoricalTranscriptRows } from '$lib/server/linkedRoomAgentGuffPurge';

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const softDeleted = dedupHistoricalTranscriptRows();
  return json({ softDeleted });
};
