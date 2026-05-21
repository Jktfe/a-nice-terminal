/**
 * /api/tasks/:taskId/dependencies — Lane-D PLANS S1.
 *
 * POST   { blockerId } → :taskId becomes blocked_by :blockerId and
 *         :blockerId gains :taskId in blocks (mirrored in ONE txn).
 * DELETE { blockerId } → remove that edge, mirrored.
 *
 * 400 on self-edge / missing body; 404 when a referenced task is absent.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addDependency, removeDependency, getTask, TaskDependencyError } from '$lib/server/taskStore';

async function readBlockerId(request: Request): Promise<string> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object body with blockerId.');
  }
  const blockerId = (body as { blockerId?: unknown }).blockerId;
  if (typeof blockerId !== 'string' || blockerId.trim().length === 0) {
    throw error(400, 'blockerId is required.');
  }
  return blockerId;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const blockerId = await readBlockerId(request);
  try {
    addDependency(params.taskId, blockerId);
  } catch (cause) {
    if (cause instanceof TaskDependencyError) {
      const notFound = cause.message.includes('not found');
      throw error(notFound ? 404 : 400, cause.message);
    }
    throw cause;
  }
  return json({ task: getTask(params.taskId) });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const blockerId = await readBlockerId(request);
  removeDependency(params.taskId, blockerId);
  return json({ task: getTask(params.taskId) });
};
