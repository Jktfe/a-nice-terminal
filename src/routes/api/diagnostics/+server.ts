/**
 * GET /api/diagnostics — admin-gated operator runtime-trust surface.
 *
 * B2-8 parity (capability-audit KEEP "operator trust surface for runtime
 * pressure"). v3 leaned on watchdog + system-pressure (B4-obsolete in
 * v4). This is v4-architecture-shaped: the things that actually bit us
 * during this build — DB/WAL growth, orphaned `node build/index`
 * processes, watcher liveness, table sizes.
 *
 * Read-only. Admin-gated via requireAdminAuth (same gate as the
 * maintenance dedup endpoint). The FE /diagnostics page (claude2 lane)
 * renders this. NEVER exposes secrets.
 *
 *   → 200 { process, db, processes, booted, counts, sampledAt }
 *   → 401/503 via requireAdminAuth
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { getIdentityDb, getDbFilePath } from '$lib/server/db';
import { getOperationalRetentionPolicy } from '$lib/server/operationalRetention';

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

function fileSizeBytes(path: string): number {
  try { return statSync(path).size; } catch { return -1; }
}

// Count live `node build/index` processes. >1 = orphaned restarts (the
// zombie incident that pegged the box). Best-effort; -1 on probe failure.
function nodeBuildProcessCount(): number {
  try {
    const r = spawnSync('/bin/ps', ['-eo', 'command'], { encoding: 'utf8', timeout: 2_000 });
    if (r.status !== 0) return -1;
    return (r.stdout ?? '')
      .split('\n')
      .filter((l) => l.includes('node build/index')).length;
  } catch { return -1; }
}

function tableCount(db: ReturnType<typeof getIdentityDb>, table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  } catch { return -1; }
}

export const GET: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);

  const dbPath = getDbFilePath();
  const db = getIdentityDb();

  const g = globalThis as unknown as Record<string, boolean | undefined>;
  const booted: Record<string, boolean> = {};
  for (const flag of BOOT_FLAGS) booted[flag] = g[flag] === true;

  const mem = process.memoryUsage();

  return json({
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      nodeVersion: process.version
    },
    db: {
      path: dbPath,
      mainBytes: fileSizeBytes(dbPath),
      walBytes: fileSizeBytes(`${dbPath}-wal`),
      shmBytes: fileSizeBytes(`${dbPath}-shm`),
      retention: getOperationalRetentionPolicy()
    },
    processes: {
      // >1 means orphaned restarts are accumulating (the pegged-CPU
      // incident). Operators should expect exactly 1 in steady state.
      nodeBuildIndexCount: nodeBuildProcessCount()
    },
    booted,
    counts: {
      terminalRecords: tableCount(db, 'terminal_records'),
      terminalRunEvents: tableCount(db, 'terminal_run_events'),
      chatRooms: tableCount(db, 'chat_rooms'),
      chatMessages: tableCount(db, 'chat_messages')
    },
    sampledAt: new Date().toISOString()
  });
};
