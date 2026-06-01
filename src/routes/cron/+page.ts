import type { PageLoad } from './$types';

type CronJob = {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'deleted';
  intervalMs: number | null;
  action: string;
  targetRoomId: string | null;
  targetMessageTemplate: string | null;
  createdByHandle: string | null;
  createdAtMs: number;
  lastFiredAtMs: number | null;
  nextFireAtMs: number | null;
  fireCount: number;
};

export const load: PageLoad = async ({ fetch }) => {
  try {
    const response = await fetch('/api/cron-jobs');
    if (!response.ok) {
      return { jobs: [] as CronJob[], fetchFailed: true };
    }
    const body = (await response.json()) as { jobs?: CronJob[] };
    return { jobs: body.jobs ?? [], fetchFailed: false };
  } catch {
    return { jobs: [] as CronJob[], fetchFailed: true };
  }
};
