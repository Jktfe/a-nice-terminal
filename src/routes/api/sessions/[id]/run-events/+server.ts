// ANT Terminal run events API
//
// GET /api/sessions/:id/run-events
//   ?since=<iso | ms | relative like 5m, 1h, 1d>
//   ?source=acp|hook|json|rpc|terminal|status|tmux
//   ?kind=message|tool_call|tool_result|permission|question|status|progress|error|system
//   ?q=<text search>
//   ?limit=<n, default 200, max 1000>
//
// If :id is a linked chat, the endpoint resolves to its owning terminal so the
// renderer can call the same route from either side of the pair.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_SINCE_MS = 60 * 60 * 1000;

type SessionRow = Record<string, any>;

function parseSince(since: string | null): number {
  if (!since) return Date.now() - DEFAULT_SINCE_MS;

  const rel = since.match(/^(\d+)([smhd])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    return Date.now() - n * (
      unit === 's' ? 1000
        : unit === 'm' ? 60_000
          : unit === 'h' ? 3_600_000
            : 86_400_000
    );
  }

  if (/^\d+$/.test(since)) return parseInt(since, 10);
  const parsed = Date.parse(since);
  return Number.isNaN(parsed) ? Date.now() - DEFAULT_SINCE_MS : parsed;
}

function parseMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === 'object') return meta as Record<string, unknown>;
  try { return JSON.parse(String(meta)) as Record<string, unknown>; }
  catch { return {}; }
}

function resolveTerminalId(session: SessionRow): string {
  if (session.type === 'terminal') return session.id;

  const meta = parseMeta(session.meta);
  const ownerId = typeof meta.auto_linked_terminal_id === 'string'
    ? meta.auto_linked_terminal_id
    : null;
  if (ownerId) return ownerId;

  const linkedTerminals = queries.getTerminalsByLinkedChat(session.id) as SessionRow[];
  if (linkedTerminals.length === 1) return linkedTerminals[0].id;

  return session.id;
}

function parsePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'string') return payload ?? {};
  try { return JSON.parse(payload); }
  catch { return {}; }
}

function parseRawRef(rawRef: unknown): unknown {
  if (!rawRef || typeof rawRef !== 'string') return rawRef ?? null;
  try { return JSON.parse(rawRef); }
  catch { return rawRef; }
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id) as SessionRow | null;
  if (!session) throw error(404, 'Session not found');

  const terminalId = resolveTerminalId(session);
  const sinceMs = parseSince(url.searchParams.get('since'));
  const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));
  const source = url.searchParams.get('source');
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q')?.trim() || null;

  const rows = queries.getRunEvents(terminalId, sinceMs, source, kind, q, limit) as any[];
  const events = rows
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      session_id: row.session_id,
      ts: row.ts_ms,
      ts_ms: row.ts_ms,
      source: row.source,
      trust: row.trust,
      kind: row.kind,
      text: row.text ?? '',
      payload: parsePayload(row.payload),
      raw_ref: parseRawRef(row.raw_ref),
      created_at: row.created_at,
    }));

  return json({
    session_id: params.id,
    terminal_id: terminalId,
    since_ms: sinceMs,
    limit,
    count: events.length,
    events,
  });
}
