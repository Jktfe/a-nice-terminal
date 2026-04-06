import { json } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

// PATCH /api/sessions/:id/tasks/:taskId
// Body: { status?, assigned_to?, description?, file_refs? }
export async function PATCH({ params, request }) {
  const { status, assigned_to, description, file_refs } = await request.json();

  queries.updateTask(
    params.taskId,
    status || null,
    assigned_to || null,
    description || null,
    file_refs ? JSON.stringify(file_refs) : null
  );

  const task = queries.getTask(params.taskId);
  if (!task) return json({ error: 'not found' }, { status: 404 });

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_updated', sessionId: params.id, task });

  return json({ task });
}

export async function DELETE({ params }) {
  queries.deleteTask(params.taskId);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_deleted', sessionId: params.id, taskId: params.taskId });

  return json({ ok: true });
}
