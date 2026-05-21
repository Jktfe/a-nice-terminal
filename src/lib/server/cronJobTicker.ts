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
 * never block the rest of the queue. lastFiredAt advances either way so
 * the operator can see the row is still being processed.
 */

import { listDueCronJobs, recordCronJobFired, type CronJob } from './cronJobStore';
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

function runRoomMessageAction(job: CronJob): void {
  const roomId = job.targetRoomId;
  const body = job.targetMessageTemplate;
  if (!roomId || !body || body.trim().length === 0) {
    logErr(`job ${job.id} room.message skipped`, 'targetRoomId + targetMessageTemplate required');
    return;
  }
  try {
    postSystemMessage({ roomId, body: `[cron · ${job.name}] ${body}` });
  } catch (cause) {
    logErr(`job ${job.id} room.message failed`, cause);
  }
}

function runConsoleLogAction(job: CronJob): void {
  // eslint-disable-next-line no-console
  console.log(`[cron] ${job.name} fired (id=${job.id} count=${job.fireCount + 1})`);
}

/**
 * Cron webhook.post action. SSRF guard + safe fetch options are shared
 * with planTriggerDispatcher via webhookSafety.ts (extracted after
 * pre-launch code review msg_53bpcfqe9j caught the unrelated dispatcher
 * missing the same guard).
 */
async function runWebhookPostAction(job: CronJob): Promise<void> {
  const url = typeof job.actionConfig.url === 'string' ? job.actionConfig.url : null;
  if (!url) {
    logErr(`job ${job.id} webhook.post skipped`, 'actionConfig.url required');
    return;
  }
  const safetyCheck = isWebhookUrlSafe(url);
  if (!safetyCheck.ok) {
    logErr(`job ${job.id} webhook.post BLOCKED`, safetyCheck.reason);
    return;
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
    if (!response.ok && response.status !== 0 && (response.status < 300 || response.status >= 400)) {
      logErr(`job ${job.id} webhook.post non-2xx`, `${response.status} ${response.statusText}`);
    }
  } catch (cause) {
    logErr(`job ${job.id} webhook.post failed`, cause);
  } finally {
    clearTimeout(timeout);
  }
}

function runTaskCreateAction(job: CronJob): void {
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
  } catch (cause) {
    logErr(`job ${job.id} task.create failed`, cause);
  }
}

async function runAction(job: CronJob): Promise<void> {
  switch (job.action) {
    case 'room.message': runRoomMessageAction(job); break;
    case 'console.log':  runConsoleLogAction(job); break;
    case 'webhook.post': await runWebhookPostAction(job); break;
    case 'task.create':  runTaskCreateAction(job); break;
  }
}

export async function tickCronJobsOnce(nowMs: number = Date.now()): Promise<number> {
  const due = listDueCronJobs(nowMs, PER_TICK_LIMIT);
  let fired = 0;
  for (const job of due) {
    try {
      await runAction(job);
    } catch (cause) {
      logErr(`job ${job.id} action threw`, cause);
    }
    try {
      recordCronJobFired(job.id, nowMs);
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
