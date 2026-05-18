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
export async function PATCH({ params, request }: RequestEvent<{ id: string; taskId: string }>) {
  const resolved = resolveTask(params);
  if (resolved.response) return resolved.response;
  const taskId = resolved.task.id;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : null;
  const assigned_to = typeof body.assigned_to === "string" && body.assigned_to.trim() ? body.assigned_to.trim() : null;
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const file_refs = body.file_refs;

  if (!status && !assigned_to && !description && file_refs == null) {
    return json({ error: "at least one of status, assigned_to, description, or file_refs is required" }, { status: 400 });
  }

  queries.updateTask(
    taskId,
    status,
    assigned_to,
    description,
    file_refs ? JSON.stringify(file_refs) : null
  );

  const task = queries.getTask(taskId);
  if (!task) return json({ error: "not found" }, { status: 404 });

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: "task_updated", sessionId: params.id, task });

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
