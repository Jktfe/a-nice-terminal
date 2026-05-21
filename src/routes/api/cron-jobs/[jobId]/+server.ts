/**
 * /api/cron-jobs/:jobId — read + lifecycle + rename + soft-delete.
 *
 *   GET    /api/cron-jobs/:jobId
 *     → 200 { job } | 404 not found
 *
 *   PATCH  /api/cron-jobs/:jobId
 *     Body: { action: 'start' | 'stop' | 'pause' | 'delete' }
 *           | { name: 'new name' }
 *     → 200 { job } on success
 *     → 400 invalid action / body / name
 *     → 404 job not found
 *
 * The 'delete' action is a soft-delete (sets status='deleted') — the row
 * stays in the table for audit + manual prune per SURFACE-SIZE-ONLY.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  deleteCronJob,
  getCronJob,
  pauseCronJob,
  renameCronJob,
  startCronJob,
  stopCronJob
} from '$lib/server/cronJobStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

const LIFECYCLE_ACTIONS = new Set(['start', 'stop', 'pause', 'delete']);

// Auth (msg_53bpcfqe9j pre-launch code review): admin-bearer OR
// browser-session. Without this, anonymous network callers could
// rename / start / pause / stop / delete any operator's cron jobs.
function requireCronAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required for /api/cron-jobs/:jobId');
}

export const GET: RequestHandler = ({ params, request }) => {
  requireCronAuth(request);
  const jobId = params.jobId ?? '';
  if (jobId.length === 0) throw error(400, 'jobId is required');
  const job = getCronJob(jobId);
  if (!job) throw error(404, 'cron job not found');
  return json({ job });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireCronAuth(request);
  const jobId = params.jobId ?? '';
  if (jobId.length === 0) throw error(400, 'jobId is required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'body must be a JSON object');
  }
  const payload = body as Record<string, unknown>;

  // Rename path: body has `name` — independent of lifecycle transitions
  // so the operator can rename a paused job without flipping its status.
  if (typeof payload.name === 'string') {
    try {
      const renamed = renameCronJob({ id: jobId, name: payload.name });
      if (!renamed) throw error(404, 'cron job not found');
      return json({ job: renamed });
    } catch (cause) {
      if (cause instanceof Response) throw cause;
      const message = cause instanceof Error ? cause.message : 'could not rename';
      throw error(400, message);
    }
  }

  // Lifecycle path: body has `action`.
  const actionRaw = payload.action;
  if (typeof actionRaw !== 'string' || !LIFECYCLE_ACTIONS.has(actionRaw)) {
    throw error(400, `action must be one of ${[...LIFECYCLE_ACTIONS].join(', ')}`);
  }

  try {
    let updated;
    switch (actionRaw) {
      case 'start':  updated = startCronJob(jobId); break;
      case 'stop':   updated = stopCronJob(jobId); break;
      case 'pause':  updated = pauseCronJob(jobId); break;
      case 'delete': updated = deleteCronJob(jobId); break;
    }
    if (!updated) throw error(404, 'cron job not found');
    return json({ job: updated });
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    const message = cause instanceof Error ? cause.message : 'could not update cron job';
    throw error(400, message);
  }
};
