import { json } from '@sveltejs/kit';
import { getHealth, canSpawn } from '$lib/server/watchdog.js';

export function GET() {
  const health = getHealth();
  const spawnCheck = canSpawn();

  return json({
    status: 'ok',
    version: '3.0.0-alpha',
    resources: {
      totalCpuPct: health.totalCpuPct,
      totalRssMb: Math.round(health.totalRssKb / 1024),
      activeSessionCount: health.activeSessionCount,
      maxActiveSessions: health.maxActiveSessions,
      atCap: health.atCap,
      canSpawn: spawnCheck.allowed,
      stalledSessions: health.stalledSessions,
      sessions: health.sessions.map(s => ({
        sessionId: s.sessionId,
        pid: s.pid,
        cpuPct: s.cpuPct,
        rssMb: Math.round(s.rssKb / 1024),
      })),
      sampledAt: health.sampledAt ? new Date(health.sampledAt).toISOString() : null,
    },
  });
}
