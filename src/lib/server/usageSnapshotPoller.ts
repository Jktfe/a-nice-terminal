/**
 * usageSnapshotPoller — interval daemon that captures one usage_snapshots
 * row every DEFAULT_SNAPSHOT_CADENCE_MS (12 h by default). JWPK
 * msg_4rbn05cztw antV4 2026-05-28: "record the updates every half a
 * day so we can get trends".
 *
 * Cadence: 12 h hits the trend ask (≈ 60 points/month is enough for a
 * sparkline, low enough that the table stays small without retention).
 * Override via $ANT_USAGE_SNAPSHOT_INTERVAL_MS for tests + sub-daily
 * smoke runs.
 *
 * Boot semantics: singleton via globalThis (mirroring the
 * agentStatusPoller pattern in [[feedback_globalthis_pattern]]). Idempotent
 * boot — calling ensureUsageSnapshotPollerBooted twice is a no-op.
 *
 * Failure semantics: a failed fetch is NOT recorded. The strip already
 * surfaces daemon-down state via the live proxy; trend rows should only
 * carry successful samples or the chart turns into noise.
 *
 * First-tick: we run one snapshot ~5 seconds after boot so a brand-new
 * install gets at least one data point before the first full 12 h
 * window elapses.
 */
import { fetchUsage } from './openUsageProxy';
import { insertUsageSnapshot } from './usageSnapshotStore';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 5_000;
const POLLER_GLOBAL_KEY = '__antUsageSnapshotPoller';

export type UsageSnapshotPollerController = {
  stop: () => void;
  runOnce: () => Promise<void>;
  isRunning: () => boolean;
};

function readCadenceMs(): number {
  const raw = Number(process.env.ANT_USAGE_SNAPSHOT_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return TWELVE_HOURS_MS;
}

async function tickOnce(): Promise<void> {
  try {
    // Bypass the 30 s proxy cache for snapshots so each tick captures
    // a fresh upstream sample, not the cached value from the last UI
    // burst-read.
    const payload = await fetchUsage({ bypassCache: true });
    // JWPK 2026-06-10: ANT-local providers (qwen, ollama) are real
    // samples even when the open-usage daemon is down, so the gate is
    // "any providers at all" rather than daemonReachable. A fully empty
    // payload is still skipped — failure ticks would muddy the trend.
    if (payload.providers.length === 0) return;
    insertUsageSnapshot(payload);
  } catch {
    // Swallow — snapshots are best-effort telemetry, not a critical
    // path. The proxy already soft-fails; this catch is belt-and-braces
    // for any future code path that could throw downstream of fetchUsage.
  }
}

/**
 * Boot the poller. Returns the existing controller on re-call so HMR
 * + double-imports don't spin a second interval.
 */
export function ensureUsageSnapshotPollerBooted(): UsageSnapshotPollerController {
  const slot = globalThis as Record<string, unknown>;
  const existing = slot[POLLER_GLOBAL_KEY] as UsageSnapshotPollerController | undefined;
  if (existing) return existing;

  let running = true;
  const cadenceMs = readCadenceMs();
  const firstTimer = setTimeout(() => {
    if (!running) return;
    void tickOnce();
  }, FIRST_TICK_DELAY_MS);
  const intervalTimer = setInterval(() => {
    if (!running) return;
    void tickOnce();
  }, cadenceMs);
  // Allow the Node event loop to exit even while these are pending —
  // matches the broader pattern of operational pollers in this repo.
  if (typeof firstTimer.unref === 'function') firstTimer.unref();
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

  const controller: UsageSnapshotPollerController = {
    stop: () => {
      running = false;
      clearTimeout(firstTimer);
      clearInterval(intervalTimer);
      delete slot[POLLER_GLOBAL_KEY];
    },
    runOnce: tickOnce,
    isRunning: () => running
  };
  slot[POLLER_GLOBAL_KEY] = controller;
  return controller;
}

/** Test helper: tear down any running poller + clear the singleton. */
export function resetUsageSnapshotPollerForTests(): void {
  const slot = globalThis as Record<string, unknown>;
  const existing = slot[POLLER_GLOBAL_KEY] as UsageSnapshotPollerController | undefined;
  if (existing) existing.stop();
  delete slot[POLLER_GLOBAL_KEY];
}
