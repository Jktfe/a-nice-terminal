import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { getTask } from '$lib/server/tasksStore';
import { listValidationRunsForClaim } from '$lib/server/validationLensStore';

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function claimAnchorForTaskDescription(description: string): string | null {
  return firstMatch(description, /Validate claim `([^`]+)` using lens `([^`]+)`\./);
}

export const GET: RequestHandler = async ({ request, url }) => {
  const taskId = url.searchParams.get('taskId');
  if (!taskId) throw error(400, 'taskId is required.');

  const task = getTask(taskId);
  if (!task) throw error(404, 'Task not found.');
  if (!task.roomId) throw error(400, 'Validation task is not room-scoped.');

  const room = findChatRoomById(task.roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);

  const claimAnchor = claimAnchorForTaskDescription(task.description);
  if (!claimAnchor) throw error(400, 'Task does not contain validation claim metadata.');
  const runs = listValidationRunsForClaim(claimAnchor);
  return json({ runs });
};
