/**
 * transcriptColdBootOffset — CRITICAL fix per v4 incident (2026-05-15).
 *
 * The transcript-tail watchers keep byte offsets in an in-memory Map.
 * On cold boot the Map is empty, so the old logic restarted every tail
 * from byte 0 — re-reading the ENTIRE JSONL backlog (689MB+ for the live
 * coordinator session). That pegs the event loop in synchronous
 * better-sqlite3 conflict probes and :6461 never serves.
 *
 * Fix: when there is no cached offset for a terminal+file (cold boot, or
 * a freshly-resolved file), START FROM EOF — only NEW appended content is
 * ingested. The backlog is intentionally skipped: transcript files
 * persist, and the cost of not backfilling a downtime window is far
 * cheaper than a server that cannot boot. Once a terminal has a cached
 * offset, normal incremental tailing resumes.
 *
 * Pure + sync (one statSync). Returns the byte offset to read FROM.
 */

import { statSync } from 'node:fs';

export function resolveTailStartOffset(
  cached: { jsonlPath: string; byteOffset: number } | undefined,
  jsonlPath: string
): number {
  if (cached && cached.jsonlPath === jsonlPath) return cached.byteOffset;
  // Cold boot OR newly-resolved file → seek to EOF, skip the backlog.
  try {
    return statSync(jsonlPath).size;
  } catch {
    return 0;
  }
}
