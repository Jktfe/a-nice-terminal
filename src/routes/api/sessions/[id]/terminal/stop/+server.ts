import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { ptyClient } from '$lib/server/pty-client.js';
import { broadcast } from '$lib/server/ws-broadcast.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';

function normalizeRunEvent(row: any) {
  if (!row) return null;
  let payload: unknown = {};
  try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}); }
  catch { payload = {}; }
  return {
    id: row.id,
    session_id: row.session_id,
    ts: row.ts_ms,
    ts_ms: row.ts_ms,
    source: row.source,
    trust: row.trust,
    kind: row.kind,
    text: row.text ?? '',
    payload,
    raw_ref: row.raw_ref ?? null,
    created_at: row.created_at,
  };
}

export async function POST(event: RequestEvent<{ id: string }>) {
  assertNotRoomScoped(event);
  const { params, request } = event;
  const session = queries.getSession(params.id) as any;
  if (!session || session.type !== 'terminal') {
    return json({ ok: false, error: 'terminal session not found' }, { status: 404 });
  }
  if (session.deleted_at || session.archived) {
    return json({ ok: false, error: 'terminal session is inactive' }, { status: 410 });
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch {}
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const requestedBy = typeof body.requested_by === 'string' ? body.requested_by.trim().slice(0, 100) : 'web';

  ptyClient.write(params.id, '\x03');

  const text = reason
    ? `Stop requested by ${requestedBy}: ${reason}`
    : `Stop requested by ${requestedBy}`;
  const row = queries.appendRunEvent(
    params.id,
    Date.now(),
    'status',
    'high',
    'terminal_stop',
    text,
    JSON.stringify({
      action: 'interrupt',
      key: 'ctrl-c',
      requested_by: requestedBy,
      reason: reason || null,
    }),
    null,
  );
  const runEvent = normalizeRunEvent(row);
  if (runEvent) broadcast(params.id, { type: 'run_event_created', sessionId: params.id, event: runEvent });

  return json({ ok: true, action: 'interrupt', key: 'ctrl-c', event: runEvent });
}
