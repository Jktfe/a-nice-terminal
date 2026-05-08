import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const tasks = queries.listTasks(params.id);
  return json({ tasks });
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveCreator(value: unknown): string | null {
  const raw = cleanOptionalString(value);
  if (!raw) return null;
  const creatorSess = queries.getSession(raw) || queries.getSessionByHandle(raw);
  return creatorSess ? (creatorSess.handle || creatorSess.id || raw) : raw;
}

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const {
    title,
    description,
    created_by,
    created_source,
    plan_id,
    milestone_id,
    acceptance_id,
  } = await request.json();
  if (!title) return json({ error: 'title required' }, { status: 400 });

  const id = nanoid();
  queries.createTask(
    id,
    params.id,
    resolveCreator(created_by),
    title,
    cleanOptionalString(description),
    {
      createdSource: cleanOptionalString(created_source) || 'api',
      planId: cleanOptionalString(plan_id),
      milestoneId: cleanOptionalString(milestone_id),
      acceptanceId: cleanOptionalString(acceptance_id),
    },
  );

  const task = queries.getTask(id);

  // Broadcast task creation to all session participants
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, { type: 'task_created', sessionId: params.id, task });

  return json({ task }, { status: 201 });
}
