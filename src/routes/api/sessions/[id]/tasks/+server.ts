import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const tasks = queries.listTasks(params.id);
  return json({ tasks });
}

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { title, description, created_by } = await request.json();
  if (!title) return json({ error: 'title required' }, { status: 400 });

  // Validate created_by — only accept handles that resolve to a real session
  let validCreator: string | null = null;
  if (created_by) {
    const creatorSess = queries.getSession(created_by) || queries.getSessionByHandle(created_by);
    validCreator = creatorSess ? (creatorSess.handle || created_by) : 'cli';
  }

  const id = nanoid();
  queries.createTask(id, params.id, validCreator, title, description || null);

  const task = queries.getTask(id);

  // Broadcast task creation to all session participants
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_created', sessionId: params.id, task });

  return json({ task }, { status: 201 });
}
