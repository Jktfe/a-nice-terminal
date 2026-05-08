import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

function resolveTask(params: { id: string; taskId: string }) {
  const exact = queries.getTask(params.taskId) as any;
  if (exact?.session_id === params.id) return { task: exact };

  const matches = queries.findTasksByIdPrefix(params.id, params.taskId) as any[];
  if (matches.length === 0) {
    return { response: json({ error: 'not found' }, { status: 404 }) };
  }
  if (matches.length > 1) {
    return {
      response: json(
        {
          error: 'ambiguous task id prefix',
          matches: matches.map((task) => ({ id: task.id, title: task.title, status: task.status })),
        },
        { status: 409 },
      ),
    };
  }
  return { task: matches[0] };
}

// PATCH /api/sessions/:id/tasks/:taskId
// Body: { status?, assigned_to?, description?, file_refs? }
export async function PATCH({ params, request }: RequestEvent<{ id: string; taskId: string }>) {
  const resolved = resolveTask(params);
  if (resolved.response) return resolved.response;
  const taskId = resolved.task.id;
  const { status, assigned_to, description, file_refs } = await request.json();

  queries.updateTask(
    taskId,
    status || null,
    assigned_to || null,
    description || null,
    file_refs ? JSON.stringify(file_refs) : null
  );

  const task = queries.getTask(taskId);
  if (!task) return json({ error: 'not found' }, { status: 404 });

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_updated', sessionId: params.id, task });

  return json({ task });
}

export async function DELETE({ params }: RequestEvent<{ id: string; taskId: string }>) {
  const resolved = resolveTask(params);
  if (resolved.response) return resolved.response;
  const taskId = resolved.task.id;
  queries.deleteTask(taskId);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_deleted', sessionId: params.id, taskId });

  return json({ ok: true });
}
