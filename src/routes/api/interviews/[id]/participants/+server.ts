import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope.js';
import { loadInterviewBundle, resolveRoomAgent } from '$lib/server/interviews.js';

function participantRef(body: Record<string, unknown> | null, event: RequestEvent<{ id: string }>): string {
  const fromBody = typeof body?.session_id === 'string' && body.session_id.trim()
    ? body.session_id.trim()
    : typeof body?.handle === 'string' && body.handle.trim()
      ? body.handle.trim()
      : '';
  return fromBody || event.url.searchParams.get('session_id')?.trim() || event.url.searchParams.get('handle')?.trim() || '';
}

async function broadcastParticipants(interviewId: string, roomId: string) {
  const bundle = loadInterviewBundle(interviewId);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(roomId, {
    type: 'interview_participants_updated',
    interview_id: interviewId,
    participants: bundle?.participants ?? [],
  });
  return bundle;
}

async function readBody(event: RequestEvent<{ id: string }>): Promise<Record<string, unknown> | null> {
  return event.request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function activeInterview(event: RequestEvent<{ id: string }>) {
  const interview = queries.getInterview(event.params.id) as any;
  if (!interview) return { error: json({ error: 'interview not found' }, { status: 404 }) };
  assertSameRoom(event, interview.room_id);
  if (interview.status !== 'active') {
    return { error: json({ error: 'interview is not active' }, { status: 409 }) };
  }
  return { interview };
}

export async function POST(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);
  const active = activeInterview(event);
  if ('error' in active) return active.error;

  const body = await readBody(event);
  const ref = participantRef(body, event);
  if (!ref) return json({ error: 'session_id or handle required' }, { status: 400 });

  const resolved = resolveRoomAgent(active.interview.room_id, ref);
  if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
  queries.addInterviewParticipant(active.interview.id, resolved.agent.id, 'participant', Boolean(body?.muted));

  return json(await broadcastParticipants(active.interview.id, active.interview.room_id), { status: 201 });
}

export async function PATCH(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);
  const active = activeInterview(event);
  if ('error' in active) return active.error;

  const body = await readBody(event);
  const ref = participantRef(body, event);
  if (!ref) return json({ error: 'session_id or handle required' }, { status: 400 });
  if (typeof body?.muted !== 'boolean') return json({ error: 'muted boolean required' }, { status: 400 });

  const resolved = resolveRoomAgent(active.interview.room_id, ref);
  if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
  const participant = queries.getInterviewParticipant(active.interview.id, resolved.agent.id) as any;
  if (!participant) return json({ error: 'participant is not in this interview' }, { status: 404 });

  queries.updateInterviewParticipantMute(active.interview.id, resolved.agent.id, body.muted);
  return json(await broadcastParticipants(active.interview.id, active.interview.room_id));
}

export async function DELETE(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);
  const active = activeInterview(event);
  if ('error' in active) return active.error;

  const body = await readBody(event);
  const ref = participantRef(body, event);
  if (!ref) return json({ error: 'session_id or handle required' }, { status: 400 });

  const resolved = resolveRoomAgent(active.interview.room_id, ref);
  if (!resolved.ok) return json({ error: resolved.error }, { status: 400 });
  const participant = queries.getInterviewParticipant(active.interview.id, resolved.agent.id) as any;
  if (!participant) return json({ error: 'participant is not in this interview' }, { status: 404 });
  if (participant.role === 'target') return json({ error: 'target participant cannot be removed' }, { status: 400 });

  queries.deleteInterviewParticipant(active.interview.id, resolved.agent.id);
  return json(await broadcastParticipants(active.interview.id, active.interview.room_id));
}
