/**
 * Chair digest note — one per room.
 *
 *   PUT    /api/chair/notes/:roomId   body { noteText }
 *     → 200 { note }                    on success (idempotent replace)
 *     → 400 { message }                 on missing/malformed body or blank note
 *     → 404                             when the room does not exist
 *
 *   DELETE /api/chair/notes/:roomId
 *     → 200 { wasCleared: boolean }     true if a note existed, false otherwise
 *     → 404                             when the room does not exist
 *
 * Backs M29 slice 2. Mirrors the fail-closed pattern from M12 breaks and
 * M03 slice 1 aliases: explicit body parsing, explicit 404, no silent
 * fall-through on malformed input.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import {
  setDigestNote,
  clearDigestNote
} from '$lib/server/chairDigestNoteStore';

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) {
    throw error(404, 'Room not found.');
  }
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}

export const PUT: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const bodyAsObject = await parseRequiredJsonBody(request);

  const noteText = bodyAsObject.noteText;
  if (typeof noteText !== 'string') {
    throw error(400, 'noteText must be a string.');
  }

  try {
    const note = setDigestNote({ roomId: params.roomId, noteText });
    return json({ note });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not set digest note.';
    throw error(400, message);
  }
};

export const DELETE: RequestHandler = ({ params }) => {
  assertRoomExists(params.roomId);
  const wasCleared = clearDigestNote(params.roomId);
  return json({ wasCleared });
};
