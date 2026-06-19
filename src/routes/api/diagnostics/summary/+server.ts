/**
 * GET /api/diagnostics/summary — operator trust surface.
 *
 * B2-8 parity. Read-only, but includes process/db/SSE internals, so callers
 * need operator/admin auth like /api/diagnostics.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import { getIdentityDb, getDbFilePath } from '$lib/server/db';
import { eventBroadcastStatsForRoom } from '$lib/server/eventBroadcast';
import { listChatRooms } from '$lib/server/chatRoomStore';
import { statSync, readFileSync } from 'node:fs';

const BOOT_FLAGS = [
  '__antRunEventsBooted', '__antTranscriptTailBooted', '__antCodexTranscriptTailBooted',
  '__antPiTranscriptTailBooted', '__antGeminiTranscriptTailBooted', '__antQwenTranscriptTailBooted',
  '__antCopilotTranscriptTailBooted', '__antLinkedRoomGuffPurged'
] as const;

function fileSizeBytes(path: string): number {
  try { return statSync(path).size; } catch { return -1; }
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return 'unknown';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/** Count 500s in the log, split into recent (last 1000 lines) vs all-time. */
function analyze500s(): { allTime: number; recent: number; latest: string | null } {
  try {
    const log = readFileSync('/tmp/ant-fresh.log', 'utf8');
    const lines = log.split('\n');
    const all500s = lines.filter((l) => l.includes('[500]'));
    const recentWindow = lines.slice(-1000);
    const recent500s = recentWindow.filter((l) => l.includes('[500]'));
    const latest = all500s.length > 0 ? all500s[all500s.length - 1]!.slice(0, 200) : null;
    return { allTime: all500s.length, recent: recent500s.length, latest };
  } catch { return { allTime: -1, recent: -1, latest: null }; }
}

/** Distribution of cli_hook lag for the last N events. */
function cliHookLagDistribution(sampleSize = 100): {
  latestMs: number; p50Ms: number; p99Ms: number; count: number;
} {
  try {
    const db = getIdentityDb();
    const rows = db
      .prepare('SELECT received_at_ms FROM cli_hook_events ORDER BY received_at_ms DESC LIMIT ?')
      .all(sampleSize) as { received_at_ms: number }[];
    if (rows.length === 0) return { latestMs: -1, p50Ms: -1, p99Ms: -1, count: 0 };
    const now = Date.now();
    const lags = rows.map((r) => now - r.received_at_ms).sort((a, b) => a - b);
    const p50 = lags[Math.floor(lags.length * 0.5)] ?? lags[lags.length - 1] ?? -1;
    const p99 = lags[Math.floor(lags.length * 0.99)] ?? lags[lags.length - 1] ?? -1;
    return { latestMs: lags[0]!, p50Ms: p50, p99Ms: p99, count: rows.length };
  } catch { return { latestMs: -1, p50Ms: -1, p99Ms: -1, count: -1 }; }
}

export const GET: RequestHandler = async ({ request }) => {
  requireOperatorLikeAuth(request);
  const dbPath = getDbFilePath();
  const db = getIdentityDb();

  const g = globalThis as unknown as Record<string, boolean | undefined>;
  const booted: Record<string, boolean> = {};
  for (const flag of BOOT_FLAGS) booted[flag] = g[flag] === true;

  let dbReachable = false;
  let dbError: string | null = null;
  try { db.prepare('SELECT 1').get(); dbReachable = true; }
  catch (cause) { dbError = cause instanceof Error ? cause.message : 'db probe failed'; }

  const rooms = listChatRooms();
  const sseRooms = rooms.map((r) => {
    const stats = eventBroadcastStatsForRoom(r.id);
    return {
      roomId: r.id,
      roomName: r.name,
      count: stats.subscriberCount,
      currentSeq: stats.currentSeq,
      eventsBroadcast: stats.eventsBroadcast,
      subscriberDeliveries: stats.subscriberDeliveries,
      subscriberDrops: stats.subscriberDrops,
      backpressureDrops: stats.backpressureDrops,
      enqueueErrorDrops: stats.enqueueErrorDrops,
      lastBroadcastAtMs: stats.lastBroadcastAtMs,
      lastBroadcastSeq: stats.lastBroadcastSeq,
      lastDropAtMs: stats.lastDropAtMs,
      lastDropReason: stats.lastDropReason
    };
  });
  const totalSseSubscribers = sseRooms.reduce((sum, s) => sum + s.count, 0);
  const totalSseBroadcasts = sseRooms.reduce((sum, s) => sum + s.eventsBroadcast, 0);
  const totalSseSubscriberDeliveries = sseRooms.reduce((sum, s) => sum + s.subscriberDeliveries, 0);
  const totalSseSubscriberDrops = sseRooms.reduce((sum, s) => sum + s.subscriberDrops, 0);

  const log500s = analyze500s();
  const hookLag = cliHookLagDistribution();

  return json({
    status: dbReachable ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    nodeVersion: process.version,
    db: {
      reachable: dbReachable, error: dbError,
      path: dbPath,
      mainBytes: fileSizeBytes(dbPath), mainSize: formatBytes(fileSizeBytes(dbPath)),
      walBytes: fileSizeBytes(`${dbPath}-wal`), walSize: formatBytes(fileSizeBytes(`${dbPath}-wal`)),
      shmBytes: fileSizeBytes(`${dbPath}-shm`), shmSize: formatBytes(fileSizeBytes(`${dbPath}-shm`))
    },
    sse: {
      totalSubscribers: totalSseSubscribers,
      totalBroadcasts: totalSseBroadcasts,
      totalSubscriberDeliveries: totalSseSubscriberDeliveries,
      totalSubscriberDrops: totalSseSubscriberDrops,
      rooms: sseRooms
    },
    log500s,
    cliHookLag: {
      latestSec: hookLag.latestMs >= 0 ? Math.round(hookLag.latestMs / 1000) : -1,
      p50Sec: hookLag.p50Ms >= 0 ? Math.round(hookLag.p50Ms / 1000) : -1,
      p99Sec: hookLag.p99Ms >= 0 ? Math.round(hookLag.p99Ms / 1000) : -1,
      sampleCount: hookLag.count
    },
    booted,
    sampledAt: new Date().toISOString()
  });
};
