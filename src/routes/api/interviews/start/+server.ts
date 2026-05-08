import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { queries } from '$lib/server/db.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope.js';
import {
  encodeInterviewMeta,
  inferTargetAgentRef,
  loadInterviewBundle,
  resolveRoomAgent,
} from '$lib/server/interviews.js';
import { normalizeStringList } from '$lib/shared/interview-contract.js';

export async function POST(event: RequestEvent) {
  assertCanWrite(event);

  const body = await event.request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  const roomId = typeof body.room_id === 'string' ? body.room_id.trim() : '';
  const sourceMessageId = typeof body.source_message_id === 'string' ? body.source_message_id.trim() : '';
  if (!roomId) return json({ error: 'room_id required' }, { status: 400 });
  if (!sourceMessageId) return json({ error: 'source_message_id required' }, { status: 400 });
  assertSameRoom(event, roomId);

  const room = queries.getSession(roomId) as any;
  if (!room) return json({ error: 'room not found' }, { status: 404 });
  if (room.type !== 'chat') return json({ error: 'room must be a chat session' }, { status: 400 });

  const sourceMessage = queries.getMessage(sourceMessageId) as any;
  if (!sourceMessage || sourceMessage.session_id !== roomId) {
    return json({ error: 'source_message_id must reference a message in this room' }, { status: 400 });
  }

  const targetRef = typeof body.target_session_id === 'string' && body.target_session_id.trim()
    ? body.target_session_id.trim()
    : inferTargetAgentRef(sourceMessage);
  if (!targetRef) {
    return json({ error: 'target_session_id required when source message sender cannot be resolved' }, { status: 400 });
  }

  const target = resolveRoomAgent(roomId, targetRef);
  if (!target.ok) return json({ error: target.error }, { status: 400 });

  const participantRefs = normalizeStringList(body.participant_session_ids);
  participantRefs.unshift(target.agent.id);
  const mutedRefs = new Set(normalizeStringList(body.muted_session_ids));
  const mutedIds = new Set<string>();
  for (const mutedRef of mutedRefs) {
    const resolved = resolveRoomAgent(roomId, mutedRef);
    if (resolved.ok) mutedIds.add(resolved.agent.id);
  }

  const participants = new Map<string, { role: 'target' | 'participant'; muted: boolean }>();
  participants.set(target.agent.id, { role: 'target', muted: mutedIds.has(target.agent.id) });
  for (const ref of participantRefs) {
    const resolved = resolveRoomAgent(roomId, ref);
    if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
    const existing = participants.get(resolved.agent.id);
    participants.set(resolved.agent.id, {
      role: existing?.role === 'target' ? 'target' : 'participant',
      muted: mutedIds.has(resolved.agent.id),
    });
  }

  const id = nanoid();
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
  const createdBy = typeof body.created_by === 'string' && body.created_by.trim() ? body.created_by.trim() : null;
  const meta = encodeInterviewMeta(body.meta, {
    source: 'interview_lite',
    selected_agents_reply_by_default: true,
    mute_controls_tts_only: true,
    global_voice_config: true,
  });

  queries.createInterview(id, roomId, sourceMessageId, target.agent.id, title, createdBy, meta);
  for (const [sessionId, participant] of participants) {
    queries.addInterviewParticipant(id, sessionId, participant.role, participant.muted);
  }

  const bundle = loadInterviewBundle(id);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(roomId, { type: 'interview_started', interview: bundle?.interview, participants: bundle?.participants ?? [] });

  return json(bundle, { status: 201 });
}
