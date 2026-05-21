/**
 * /api/cron-jobs — operator-defined recurring jobs (JWPK msg_hjv6ac64zo).
 *
 *   GET   /api/cron-jobs[?includeDeleted=true&createdByHandle=@x]
 *     → 200 { jobs: CronJob[] }
 *
 *   POST  /api/cron-jobs
 *     Body: { name, intervalMs, action?, actionConfig?, targetRoomId?,
 *             targetMessageTemplate?, startImmediately? }
 *     → 201 { job: CronJob }
 *     → 400 invalid body / missing required fields
 *     → 401 missing auth (admin-bearer OR browser-session)
 *
 * Auth (msg_53bpcfqe9j pre-launch code review): admin-bearer OR
 * browser-session — same cascade as the terminal settings endpoint.
 * The earlier 'no auth gate in v1' premise was wrong (the route
 * comment referenced plan-triggers which actually DOES require admin
 * auth). Without this, anonymous network callers could create
 * `room.message` cron jobs that spoof @system at unbounded rate,
 * task.create jobs in any plan, etc.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createCronJob,
  listCronJobs,
  type CronJobAction
} from '$lib/server/cronJobStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';

function requireCronAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required for /api/cron-jobs');
}

const VALID_ACTIONS: CronJobAction[] = ['room.message', 'console.log', 'webhook.post', 'task.create'];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const GET: RequestHandler = ({ url, request }) => {
  requireCronAuth(request);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const createdByHandle = url.searchParams.get('createdByHandle') ?? undefined;
  const jobs = listCronJobs({
    includeDeleted,
    createdByHandle: createdByHandle && createdByHandle.length > 0 ? createdByHandle : undefined
  });
  return json({ jobs });
};

export const POST: RequestHandler = async ({ request }) => {
  requireCronAuth(request);
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
  const name = asString(payload.name);
  if (!name) throw error(400, 'name is required');
  const intervalMs = typeof payload.intervalMs === 'number' ? payload.intervalMs : null;
  if (intervalMs === null || !Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw error(400, 'intervalMs must be a number >= 1000');
  }
  const actionRaw = asString(payload.action) ?? 'room.message';
  if (!VALID_ACTIONS.includes(actionRaw as CronJobAction)) {
    throw error(400, `action must be one of ${VALID_ACTIONS.join(', ')}`);
  }
  const action = actionRaw as CronJobAction;
  const actionConfig = payload.actionConfig && typeof payload.actionConfig === 'object' && !Array.isArray(payload.actionConfig)
    ? (payload.actionConfig as Record<string, unknown>)
    : undefined;
  const startImmediately = payload.startImmediately === true;
  try {
    const job = createCronJob({
      name,
      intervalMs,
      action,
      actionConfig,
      targetRoomId: asString(payload.targetRoomId),
      targetMessageTemplate: asString(payload.targetMessageTemplate),
      createdByHandle: asString(payload.createdByHandle),
      startImmediately
    });
    return json({ job }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not create cron job';
    throw error(400, message);
  }
};
