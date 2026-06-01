/**
 * GET /api/audit/events — admin-bearer-gated reader over the canonical
 * v0.2 `audit_events` table. Part of M7.1 (PATH 3) — see
 * `src/lib/server/auditEventsStore.ts` for the store interface and the
 * antos-enterprise-control-plane plan for scope.
 *
 * Query params (all optional):
 *   - cursor: opaque pagination token returned in the prior page's
 *     `nextCursor`. Encodes `<at_ms>_<audit_id>` so pagination is
 *     stable even when multiple events land in the same millisecond.
 *   - limit: 1..500 (default 100). Out-of-range values clamp.
 *   - kind / entityKind / entityId / actorAgentId: equality filters
 *     against the matching audit_events columns.
 *   - since / until: integer ms timestamps (inclusive).
 *
 * Response negotiation:
 *   - Default (`Accept: application/json` or no Accept header) returns
 *     `{ events: AuditEvent[], nextCursor: string | null }`.
 *   - `Accept: application/x-ndjson` streams newline-delimited JSON,
 *     one AuditEvent per line, with no envelope. `nextCursor` is not
 *     emitted in NDJSON mode — callers paginate by passing the last
 *     event's `<atMs>_<auditId>` as the next `cursor` query param.
 *
 * 401 without admin-bearer (`ANT_ADMIN_TOKEN` constant-time match via
 * `tryAdminBearer`). The endpoint deliberately does not fall back to
 * pidChain / cookie auth — audit reads are an operator-only surface.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from './$types';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import {
  listAuditEvents,
  type AuditEvent,
  type AuditEventFilter
} from '$lib/server/auditEventsStore';

function parseIntegerParam(value: string | null): number | undefined {
  if (value === null || value.length === 0) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function buildFilterFromUrl(url: URL): AuditEventFilter {
  return {
    cursor: url.searchParams.get('cursor'),
    limit: parseIntegerParam(url.searchParams.get('limit')),
    kind: url.searchParams.get('kind') ?? undefined,
    entityKind: url.searchParams.get('entityKind') ?? undefined,
    entityId: url.searchParams.get('entityId') ?? undefined,
    actorAgentId: url.searchParams.get('actorAgentId') ?? undefined,
    since: parseIntegerParam(url.searchParams.get('since')),
    until: parseIntegerParam(url.searchParams.get('until'))
  };
}

function wantsNdjson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.toLowerCase().includes('application/x-ndjson');
}

function streamNdjson(events: AuditEvent[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export const GET: RequestHandler = (event: RequestEvent) => {
  const { request, url } = event;
  if (!tryAdminBearer(request)) {
    throw error(401, 'admin_bearer_required');
  }

  const filter = buildFilterFromUrl(url);
  const { events, nextCursor } = listAuditEvents(filter);

  if (wantsNdjson(request)) {
    return streamNdjson(events);
  }

  return json({ events, nextCursor });
};
