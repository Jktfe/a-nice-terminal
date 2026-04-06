import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params }) {
  const tasks = queries.listTasks(params.id);
  return json({ tasks });
}

export async function POST({ params, request }) {
  const { title, description, created_by } = await request.json();
  if (!title) return json({ error: 'title required' }, { status: 400 });

  const id = nanoid();
  queries.createTask(id, params.id, created_by || null, title, description || null);

  const task = queries.getTask(id);

  // Broadcast task creation to all session participants
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_created', sessionId: params.id, task });

  return json({ task }, { status: 201 });
}
