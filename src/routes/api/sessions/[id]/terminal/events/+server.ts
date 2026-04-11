// ANT v3 — Terminal control-mode events API
//
// GET /api/sessions/:id/terminal/events
//   ?since=<iso | ms | relative like "5m" | "1h">
//   ?kind=<window-add|session-changed|layout-change|alert-silence|…>
//   ?limit=<n, default 100, max 1000>
//
// Structured timeline from tmux control mode. Paired with
// /api/sessions/:id/terminal/history (which returns the raw byte stream) —
// events tell you *what happened* (new window, layout change, exit),
// transcripts tell you *what was printed*.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_SINCE_MS = 60 * 60 * 1000; // 1h

function parseSince(since: string | null): number {
  if (!since) return Date.now() - DEFAULT_SINCE_MS;
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
  if (/^\d+$/.test(since)) return parseInt(since, 10);
  const parsed = Date.parse(since);
  if (!isNaN(parsed)) return parsed;
  return Date.now() - DEFAULT_SINCE_MS;
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  const sinceMs = parseSince(url.searchParams.get('since'));
  const kind = url.searchParams.get('kind');
  const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));

  const rows = queries.getTerminalEvents(params.id, sinceMs, kind, limit) as any[];

  return json({
    session_id: params.id,
    since_ms: sinceMs,
    kind: kind ?? null,
    limit,
    count: rows.length,
    rows: rows.map(r => ({
      id: r.id,
      ts_ms: r.ts_ms,
      kind: r.kind,
      data: safeParse(r.data),
    })),
  });
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
