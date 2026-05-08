import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope.js';
import { postInterviewSummary } from '$lib/server/interview-summary.js';

export async function POST(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);

  const interview = queries.getInterview(event.params.id) as any;
  if (!interview) return json({ error: 'interview not found' }, { status: 404 });
  assertSameRoom(event, interview.room_id);

  const body = await event.request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  const summaryText = typeof body.summary_text === 'string' && body.summary_text.trim()
    ? body.summary_text.trim()
    : typeof body.content === 'string' && body.content.trim()
      ? body.content.trim()
      : '';
  const speakerRef = typeof body.speaker_session_id === 'string' && body.speaker_session_id.trim()
    ? body.speaker_session_id.trim()
    : '';
  if (!speakerRef) return json({ error: 'speaker_session_id required' }, { status: 400 });

  const result = await postInterviewSummary({
    interview,
    summaryText,
    speakerRef,
    meta: body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
      ? body.meta as Record<string, unknown>
      : undefined,
  });

  if (!result.ok) return json({ error: result.error }, { status: result.status });
  return json({
    message: result.message,
    interview: result.interview,
    deliveries: result.deliveries,
  }, { status: 201 });
}
