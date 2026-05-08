// Pure client-safe freshness classifier for ~/.ant/state/<cli>/<id>.json.
// Lives here (not in agent-state-reader.ts) because the reader imports
// node:fs/os/path and must not leak into the browser bundle. The reader
// re-exports from this module so server callers keep their existing
// import surface; the UI imports from here directly.

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
