/**
 * GET /api/terminals/[id]/run-events?since=<ts_ms>&limit=<n>
 *   Returns the persisted run_events for one terminal — the data behind
 *   the ANT view "retained forever" scrollback (T2a slice). When `since`
 *   is omitted, returns the most recent `limit` events (default 200);
 *   when present, returns events with ts_ms > since (default cap 500).
 *
 * Per linkedchat-backend-v3-audit Q4 + T2a-redesign locked acceptance.
 * #112 terminal-history-persistence: added since=relative (5m,1h),
 * grep=text search, raw=1 for ANSI passthrough.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';
import {
  listLatestTerminalRunEvents,
  listTerminalRunEventsSince,
  searchTerminalRunEvents,
} from '$lib/server/terminalRunEventsStore';

function parseSince(since: string | null): number | null {
  if (!since) return null;

  // Relative: "5m", "2h", "30s", "1d"
  const rel = since.match(/^(\d+)([smhd])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms = n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
    return Date.now() - ms;
  }

  // Pure number → epoch ms
  if (/^\d+$/.test(since)) return parseInt(since, 10);

  // ISO string
  const parsed = Date.parse(since);
  if (!isNaN(parsed)) return parsed;

  return null;
}

export const GET: RequestHandler = ({ params, request, url }) => {
  requireOperatorLikeAuth(request);
  const terminalId = params.id ?? '';
  if (terminalId.length === 0) throw error(400, 'terminal id required.');

  const sinceParam = url.searchParams.get('since');
  const limitParam = url.searchParams.get('limit');
  const kindsParam = url.searchParams.get('kinds');
  const sourcesParam = url.searchParams.get('sources');
  const grepParam = url.searchParams.get('grep');
  const rawParam = url.searchParams.get('raw');

  const limit = limitParam !== null && Number.isFinite(Number(limitParam))
    ? Math.max(1, Math.min(1000, Number(limitParam)))
    : 200;

  const kinds = kindsParam !== null && kindsParam.length > 0
    ? kindsParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : undefined;

  const sources = sourcesParam !== null && sourcesParam.length > 0
    ? sourcesParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : undefined;

  // #112: grep mode ignores since/limit defaults and returns matched rows
  if (grepParam !== null && grepParam.length > 0) {
    const events = searchTerminalRunEvents(terminalId, grepParam, limit, kinds, sources);
    return json({ events, mode: 'search', query: grepParam });
  }

  const sinceMs = parseSince(sinceParam);
  const events = sinceMs !== null
    ? listTerminalRunEventsSince(terminalId, sinceMs, limit, kinds, sources)
    : listLatestTerminalRunEvents(terminalId, limit, kinds, sources);

  // #112: raw=1 returns ANSI bytes untouched (only relevant for kind=raw rows)
  if (rawParam === '1') {
    return json({ events, raw: true });
  }

  return json({ events });
};
