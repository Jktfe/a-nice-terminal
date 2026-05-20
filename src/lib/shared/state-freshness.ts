// Pure client-safe freshness classifier for ~/.ant/state/<cli>/<id>.json.
// Lives in lib/shared so both server (agent-state-reader) and UI (status
// dot) can import without dragging node:fs/os/path into the browser
// bundle. Lifted from v3 src/lib/shared/state-freshness.ts (2026-05-15
// AGENT-STATE-READER lift slice).

export const STATE_FRESHNESS_LIVE_MS = 30_000;

export type StateFreshness = 'live' | 'stale' | 'absent';

/**
 * Classify how recently a state file was touched, for UI rendering.
 *
 *   absent — no file (mtimeMs undefined / non-finite)
 *   live   — touched within STATE_FRESHNESS_LIVE_MS
 *   stale  — touched longer ago than that
 *
 * Pure function; UI passes a $state-tracked `now` so the chip transitions
 * live → stale as time advances without server round-trips.
 */
export function classifyStateFreshness(
  mtimeMs: number | undefined,
  now: number = Date.now()
): StateFreshness {
  if (mtimeMs === undefined || !Number.isFinite(mtimeMs)) return 'absent';
  return now - mtimeMs < STATE_FRESHNESS_LIVE_MS ? 'live' : 'stale';
}
