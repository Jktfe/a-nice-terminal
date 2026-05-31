// Exponential backoff with jitter for transport reconnects.

const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const JITTER_PCT = 0.2;

export function nextBackoff(attempt: number): number {
  const base = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)];
  const jitter = base * JITTER_PCT * (Math.random() * 2 - 1); // ±20%
  return Math.max(100, Math.round(base + jitter));
}
