/**
 * /api/terminals/:id/tasks — JWPK TASKS-SUBSYSTEM (2026-05-16).
 *
 * Convenience filter: returns every task bound to this terminal via
 * `assigned_terminal_id`. Used by `ant terminal <name> listtasks`.
 *
 * GET → 200 { terminalId, tasks: JwpkTask[] }
 *       (returns the bag with `terminalId` so the caller doesn't have to
 *       round-trip back through /api/terminals to confirm the id.)
 *
 * No POST/PATCH/DELETE here — write surfaces stay on /api/tasks so
 * there's exactly one place to send mutations.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasks } from '$lib/server/tasksStore';

export const GET: RequestHandler = async ({ params }) => {
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminalId required.');
  const tasks = listTasks({ assignedTerminalId: terminalId });
  return json({ terminalId, tasks });
};
