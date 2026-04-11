// ANT v3 — Terminal history API
//
// GET /api/sessions/:id/terminal/history
//   ?since=<iso | ms | relative like "5m" | "1h">
//   ?grep=<FTS5 query>
//   ?limit=<n, default 100, max 1000>
//   ?raw=1          → include raw bytes (ANSI intact); default returns stripped text
//
// Two modes:
//   grep set   → FTS5 search across the session's transcripts, ranked
//   grep unset → time-window scan ordered by ts_ms DESC
//
// Agents and the idle-tick script read this to mine terminal history without
// having to scrape xterm or parse tmux capture-pane output.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_SINCE_MS = 60 * 60 * 1000; // 1h if no since given

function parseSince(since: string | null): number {
  if (!since) return Date.now() - DEFAULT_SINCE_MS;

  // Relative: "5m", "2h", "30s", "1d"
  const rel = since.match(/^(\d+)([smhd])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms = n * (unit === 's' ? 1000
                  : unit === 'm' ? 60_000
                  : unit === 'h' ? 3_600_000
                  : 86_400_000);
    return Date.now() - ms;
  }

  // Pure number → epoch ms
  if (/^\d+$/.test(since)) return parseInt(since, 10);

  // ISO string
  const parsed = Date.parse(since);
  if (!isNaN(parsed)) return parsed;

  return Date.now() - DEFAULT_SINCE_MS;
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  const grep = url.searchParams.get('grep');
  const raw = url.searchParams.get('raw') === '1';
  const sinceMs = parseSince(url.searchParams.get('since'));
  const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));

  if (grep) {
    // FTS5 search — ignores `since` and `raw` since it returns snippet highlights.
    const rows = queries.searchTranscripts(params.id, grep, limit) as any[];
    return json({
      session_id: params.id,
      mode: 'search',
      query: grep,
      limit,
      count: rows.length,
      rows: rows.map(r => ({
        id: r.id,
        chunk_index: r.chunk_index,
        ts_ms: r.ts_ms,
        byte_offset: r.byte_offset,
        size: r.size,
        snippet: r.snippet,
      })),
    });
  }

  // Time-window scan. Strip by default; return raw only if explicitly requested.
  const rows = queries.getTranscriptsSince(params.id, sinceMs, limit) as any[];
  if (raw) {
    return json({
      session_id: params.id,
      mode: 'range',
      since_ms: sinceMs,
      limit,
      count: rows.length,
      rows: rows.map(r => ({
        id: r.id,
        chunk_index: r.chunk_index,
        ts_ms: r.ts_ms,
        byte_offset: r.byte_offset,
        size: r.size,
        raw: typeof r.raw_data === 'string' ? r.raw_data : r.raw_data?.toString?.('utf8') ?? '',
      })),
    });
  }

  // Stripped text path — fetch clean text for the rows' time window in a
  // single query against the FTS mirror, then attach by id. Rows written by
  // the legacy appendTranscript before this commit won't have an FTS row and
  // fall through with text=''.
  const stripMap = new Map<number, string>();
  if (rows.length) {
    const oldest = Math.min(...rows.map((r: any) => r.ts_ms));
    const newest = Math.max(...rows.map((r: any) => r.ts_ms));
    const stripped = queries.getTranscriptRangeStripped(params.id, oldest, newest) as any[];
    for (const s of stripped) stripMap.set(s.id, s.text ?? '');
  }

  return json({
    session_id: params.id,
    mode: 'range',
    since_ms: sinceMs,
    limit,
    count: rows.length,
    rows: rows.map((r: any) => ({
      id: r.id,
      chunk_index: r.chunk_index,
      ts_ms: r.ts_ms,
      byte_offset: r.byte_offset,
      size: r.size,
      text: stripMap.get(r.id) ?? '',
    })),
  });
}
