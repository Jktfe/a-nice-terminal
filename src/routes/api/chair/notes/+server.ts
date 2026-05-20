/**
 * Chair digest notes — list view.
 *
 *   GET /api/chair/notes  →  200 { notes: ChairDigestNote[] }
 *
 * Backs M29 slice 2 chair digest notes. Per-room writes live at
 * /api/chair/notes/[roomId] so the list endpoint stays read-only.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDigestNotes } from '$lib/server/chairDigestNoteStore';

export const GET: RequestHandler = () => {
  return json({ notes: listDigestNotes() });
};
