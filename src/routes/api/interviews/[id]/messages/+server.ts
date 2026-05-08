import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { queries } from '$lib/server/db.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope.js';
import { encodeInterviewMeta, loadInterviewBundle, resolveRoomAgent } from '$lib/server/interviews.js';
import { routeInterviewUserMessage } from '$lib/server/interview-routing.js';
import { isInterviewMessageRole } from '$lib/shared/interview-contract.js';

export async function POST(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);

  const interview = queries.getInterview(event.params.id) as any;
  if (!interview) return json({ error: 'interview not found' }, { status: 404 });
  assertSameRoom(event, interview.room_id);
  if (interview.status !== 'active') {
    return json({ error: 'interview is not active' }, { status: 409 });
  }

  const body = await event.request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  const role = typeof body.role === 'string' && isInterviewMessageRole(body.role) ? body.role : null;
  if (!role) return json({ error: 'role must be user, agent, or system' }, { status: 400 });

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return json({ error: 'content required' }, { status: 400 });

  let speakerSessionId = typeof body.speaker_session_id === 'string' && body.speaker_session_id.trim()
    ? body.speaker_session_id.trim()
    : null;
  if (role === 'agent') {
    if (!speakerSessionId) return json({ error: 'agent messages require speaker_session_id' }, { status: 400 });
    const resolved = resolveRoomAgent(interview.room_id, speakerSessionId);
    if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
    speakerSessionId = resolved.agent.id;
    const participant = queries.getInterviewParticipant(interview.id, speakerSessionId) as any;
    if (!participant) return json({ error: 'speaker_session_id is not an interview participant' }, { status: 400 });
  }
  if (speakerSessionId && role !== 'user') {
    const member = queries.getRoomMember(interview.room_id, speakerSessionId) as any;
    if (!member || member.role !== 'participant') {
      return json({ error: 'speaker_session_id must belong to the interview room' }, { status: 400 });
    }
  }

  const id = nanoid();
  const format = typeof body.format === 'string' && body.format.trim() ? body.format.trim() : 'text';
  const status = typeof body.status === 'string' && body.status.trim() ? body.status.trim() : 'complete';
  const audioCacheKey = typeof body.audio_cache_key === 'string' && body.audio_cache_key.trim() ? body.audio_cache_key.trim() : null;
  const audioMimeType = typeof body.audio_mime_type === 'string' && body.audio_mime_type.trim() ? body.audio_mime_type.trim() : null;
  const audioDurationMs = typeof body.audio_duration_ms === 'number' && Number.isFinite(body.audio_duration_ms)
    ? Math.max(0, Math.floor(body.audio_duration_ms))
    : null;
  const meta = encodeInterviewMeta(body.meta);

  queries.createInterviewMessage(
    id,
    interview.id,
    role,
    speakerSessionId,
    content,
    format,
    status,
    audioCacheKey,
    audioMimeType,
    audioDurationMs,
    meta,
  );

  const message = queries.getInterviewMessage(id);
  const deliveries = role === 'user' && message
    ? await routeInterviewUserMessage(interview, message as any)
    : [];
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(interview.room_id, { type: 'interview_message_created', interview_id: interview.id, message });

  return json({ message, interview: loadInterviewBundle(interview.id)?.interview, deliveries }, { status: 201 });
}
