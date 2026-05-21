import type { PageLoad } from './$types';

export type DiagnosticsSummary = {
  status: string;
  uptimeSeconds: number;
  pid: number;
  nodeVersion: string;
  db: {
    reachable: boolean;
    error: string | null;
    path: string;
    mainBytes: number;
    mainSize: string;
    walBytes: number;
    walSize: string;
    shmBytes: number;
    shmSize: string;
  };
  sse: {
    totalSubscribers: number;
    rooms: { roomId: string; roomName: string; count: number }[];
  };
  log500s: {
    allTime: number;
    recent: number;
    latest: string | null;
  };
  cliHookLag: {
    latestSec: number;
    p50Sec: number;
    p99Sec: number;
    sampleCount: number;
  };
  booted: Record<string, boolean>;
  sampledAt: string;
};

export type HealthData = {
  status: string;
  uptimeSeconds: number;
  pid: number;
  db: { reachable: boolean; error: string | null };
  booted: Record<string, boolean>;
  sampledAt: string;
};

export const load: PageLoad = async ({ fetch }) => {
  const [healthResp, summaryResp] = await Promise.all([
    fetch('/api/health').catch(() => null),
    fetch('/api/diagnostics/summary').catch(() => null)
  ]);

  const health = healthResp?.ok ? (await healthResp.json() as HealthData) : null;
  const summary = summaryResp?.ok ? (await summaryResp.json() as DiagnosticsSummary) : null;

  return { health, summary };
};
