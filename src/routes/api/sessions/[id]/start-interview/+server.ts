// POST /api/sessions/:id/start-interview
//
// M2 #1 wire: thin wrapper over startInterview() in src/lib/server/interview/
// start-interview.ts. UI (agent card / room mention) calls this; the helper
// decides whether to create a fresh linked chat or focus an existing one.

import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { startInterview } from '$lib/server/interview/start-interview.js';

export async function POST({ params, request }: RequestEvent) {
  const targetSessionId = params.id!;
  const body = await request.json().catch(() => ({}));

  const result = startInterview(queries as any, targetSessionId, {
    origin_room_id: typeof body?.origin_room_id === 'string' ? body.origin_room_id : null,
    caller_handle:  typeof body?.caller_handle  === 'string' ? body.caller_handle  : null,
  });

  if (!result.ok) {
    if (result.error === 'target_not_found')   throw error(404, 'Target session not found');
    if (result.error === 'invalid_target_type') throw error(400, 'Target session is not a terminal/chat/agent');
    if (result.error === 'recursive_interview') throw error(400, 'Target is already an interview chat');
  }

  return json(result);
}
