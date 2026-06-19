/**
 * cronJobTicker — server-side scanner that fires due cron jobs.
 *
 * Boot once via globalThis flag (banked pattern from terminalRunEventsBoot
 * + agentStatusPoller). Every TICK_INTERVAL_MS:
 *   1. listDueCronJobs(now) — running jobs whose next_fire_at_ms <= now
 *   2. For each: run the configured action, then recordCronJobFired to
 *      advance next_fire_at_ms by intervalMs.
 *
 * Action handlers (v1) reuse the plan-trigger dispatcher vocabulary:
 *   - room.message  → post a system message to targetRoomId with
 *                     targetMessageTemplate (literal text in v1; template
 *                     interpolation a v2 lane).
 *   - console.log   → write `[cron] <name> fired` to stderr. Useful for
 *                     dry-run debugging without touching a room.
 *   - webhook.post  → POST {jobId, name, firedAtMs, ...actionConfig} to
 *                     actionConfig.url. Surfaces non-2xx in the server log.
 *   - task.create   → create a follow-up task. Uses tasksStore.
 *
 * Failures in any action are swallowed + logged — one broken job must
 * never block the rest of the queue. The scheduler still advances after
 * each attempt, but the row records an explicit last-outcome status/message
 * so a failed tick does not masquerade as a clean fire.
 */

import {
  listDueCronJobs,
  recordCronJobFired,
  type CronJob,
  type CronJobOutcome
} from './cronJobStore';
import { postSystemMessage } from './chatMessageStore';
import { createTask } from './tasksStore';
import { isWebhookUrlSafe, webhookFetchOptions } from './webhookSafety';

// Re-export for back-compat with the cronJobTicker.test.ts unit tests
// that import from this module; the canonical implementation now lives
// in webhookSafety.ts.
export { isWebhookUrlSafe };

const BOOT_KEY = '__antCronJobTickerBooted';
const TICK_INTERVAL_MS = 5_000;
const PER_TICK_LIMIT = 50;

function logErr(prefix: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  // Best-effort console — never throw out of the ticker.
  // eslint-disable-next-line no-console
  console.error(`[cronJobTicker] ${prefix}: ${msg}`);
}

function runRoomMessageAction(job: CronJob): CronJobOutcome {
  const roomId = job.targetRoomId;
  const body = job.targetMessageTemplate;
  if (!roomId || !body || body.trim().length === 0) {
    const message = 'targetRoomId + targetMessageTemplate required';
    logErr(`job ${job.id} room.message skipped`, message);
    return { status: 'skipped', message };
  }
  try {
    postSystemMessage({ roomId, body: `[cron · ${job.name}] ${body}` });
    return { status: 'succeeded', message: `Posted cron message to room ${roomId}.` };
  } catch (cause) {
    logErr(`job ${job.id} room.message failed`, cause);
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause)
    };
  }
}

function runConsoleLogAction(job: CronJob): CronJobOutcome {
  // eslint-disable-next-line no-console
  console.log(`[cron] ${job.name} fired (id=${job.id} count=${job.fireCount + 1})`);
  return { status: 'succeeded', message: 'Logged cron fire to the server console.' };
}

/**
 * Cron webhook.post action. SSRF guard + safe fetch options are shared
 * with planTriggerDispatcher via webhookSafety.ts (extracted after
 * pre-launch code review msg_53bpcfqe9j caught the unrelated dispatcher
 * missing the same guard).
 */
async function runWebhookPostAction(job: CronJob): Promise<CronJobOutcome> {
  const url = typeof job.actionConfig.url === 'string' ? job.actionConfig.url : null;
  if (!url) {
    const message = 'actionConfig.url required';
    logErr(`job ${job.id} webhook.post skipped`, message);
    return { status: 'skipped', message };
  }
  const safetyCheck = isWebhookUrlSafe(url);
  if (!safetyCheck.ok) {
    logErr(`job ${job.id} webhook.post BLOCKED`, safetyCheck.reason);
    return { status: 'blocked', message: `Webhook URL blocked: ${safetyCheck.reason}` };
  }
  const { init, timeout } = webhookFetchOptions('cron');
  try {
    const response = await fetch(url, {
      ...init,
      body: JSON.stringify({
        jobId: job.id,
        name: job.name,
        firedAtMs: Date.now(),
        actionConfig: job.actionConfig
      })
    });
    if (!response.ok && response.status !== 0) {
      const message = `${response.status} ${response.statusText}`.trim();
      logErr(`job ${job.id} webhook.post non-2xx`, message);
      return { status: 'failed', message: `Webhook POST failed: ${message}` };
    }
    return { status: 'succeeded', message: `Webhook POST completed for ${url}.` };
  } catch (cause) {
    logErr(`job ${job.id} webhook.post failed`, cause);
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runTaskCreateAction(job: CronJob): CronJobOutcome {
  const title = typeof job.actionConfig.title === 'string'
    ? job.actionConfig.title
    : `[cron] ${job.name} — fired at ${new Date().toISOString()}`;
  const planId = typeof job.actionConfig.planId === 'string' ? job.actionConfig.planId : null;
  try {
    createTask({
      title,
      planId,
      createdBy: job.createdByHandle ?? null,
      description: `Auto-created by cron job ${job.name} (${job.id}).`
    });
    return { status: 'succeeded', message: `Created task: ${title}` };
  } catch (cause) {
    logErr(`job ${job.id} task.create failed`, cause);
    return {
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause)
    };
  }
}

async function runAction(job: CronJob): Promise<CronJobOutcome> {
  switch (job.action) {
    case 'room.message': return runRoomMessageAction(job);
    case 'console.log':  return runConsoleLogAction(job);
    case 'webhook.post': return await runWebhookPostAction(job);
    case 'task.create':  return runTaskCreateAction(job);
  }
}

export async function tickCronJobsOnce(nowMs: number = Date.now()): Promise<number> {
  const due = listDueCronJobs(nowMs, PER_TICK_LIMIT);
  let fired = 0;
  for (const job of due) {
    let outcome: CronJobOutcome;
    try {
      outcome = await runAction(job);
    } catch (cause) {
      logErr(`job ${job.id} action threw`, cause);
      outcome = {
        status: 'failed',
        message: cause instanceof Error ? cause.message : String(cause)
      };
    }
    try {
      recordCronJobFired(job.id, nowMs, outcome);
      fired += 1;
    } catch (cause) {
      logErr(`job ${job.id} recordFired failed`, cause);
    }
  }
  return fired;
}

export function ensureCronJobTickerBooted(): void {
  const slot = globalThis as Record<string, unknown>;
  if (slot[BOOT_KEY]) return;
  slot[BOOT_KEY] = true;
  setInterval(() => {
    void tickCronJobsOnce().catch((cause) => logErr('tick failed', cause));
  }, TICK_INTERVAL_MS).unref?.();
}
