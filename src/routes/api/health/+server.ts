/**
 * GET /api/health — ops/monitoring liveness + readiness probe.
 *
 * v3 parity (B2-5 / M-PARITY-4). v3's /api/health leaned on watchdog +
 * system-pressure (B4 obsolete in v4). v4's health reflects the v4
 * architecture: process up, DB reachable, and which boot-once subsystems
 * have fired (persistence + the 6 transcript-tail watchers). Used by
 * restart-verify and dogfood trust checks.
 *
 * Returns 200 with { status:'ok', ... } when DB is reachable, 503 with
 * { status:'degraded', ... } when the DB probe fails.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';

const BOOT_FLAGS = [
  '__antRunEventsBooted',
  '__antTranscriptTailBooted',
  '__antCodexTranscriptTailBooted',
  '__antPiTranscriptTailBooted',
  '__antGeminiTranscriptTailBooted',
  '__antQwenTranscriptTailBooted',
  '__antCopilotTranscriptTailBooted',
  '__antLinkedRoomGuffPurged'
] as const;

export const GET: RequestHandler = async () => {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  const booted: Record<string, boolean> = {};
  for (const flag of BOOT_FLAGS) booted[flag] = g[flag] === true;

  let dbReachable = false;
  let dbError: string | null = null;
  try {
    getIdentityDb().prepare('SELECT 1').get();
    dbReachable = true;
  } catch (cause) {
    dbError = cause instanceof Error ? cause.message : 'db probe failed';
  }

  const body = {
    status: dbReachable ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    db: { reachable: dbReachable, error: dbError },
    booted,
    sampledAt: new Date().toISOString()
  };
  return json(body, { status: dbReachable ? 200 : 503 });
};
