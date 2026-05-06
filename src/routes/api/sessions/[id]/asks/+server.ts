import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { createAskId } from '$lib/server/ask-ids';
import {
  normalizeAskOwnerKind,
  normalizeAskPriority,
  normalizeAskStatus,
  titleFromAskContent,
} from '$lib/server/ask-inference';
import { assertCanWrite, assertSameRoom } from '$lib/server/room-scope';
import { emitAskRunEvent } from '$lib/server/ask-events';

const ACTIVE_STATUSES = ['open', 'candidate', 'deferred'];

function parseStatuses(raw: string | null): string[] | null {
  if (!raw || raw === 'active' || raw === 'pending') return ACTIVE_STATUSES;
  if (raw === 'all') return null;
  return raw.split(',')
    .map((part) => normalizeAskStatus(part.trim(), 'open'))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function parseLimit(raw: string | null): number {
  const value = Number(raw || 100);
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(Math.floor(value), 500));
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function publicAsk(row: any) {
  return {
    ...row,
    inferred: row.inferred === 1,
    confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence ?? 0),
    meta: parseJsonObject(row.meta),
  };
}

export function GET(event: RequestEvent<{ id: string }>) {
  assertSameRoom(event, event.params.id);
  const asks = queries.listAsks({
    sessionId: event.params.id,
    statuses: parseStatuses(event.url.searchParams.get('status')),
    assignedTo: event.url.searchParams.get('assigned_to') || event.url.searchParams.get('assignedTo'),
    limit: parseLimit(event.url.searchParams.get('limit')),
  }).map(publicAsk);

  return json({ asks });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  assertSameRoom(event, event.params.id);
  assertCanWrite(event);
  const body = await event.request.json();
  const rawTitle = String(body.title || body.question || '').trim();
  const rawBody = String(body.body || body.context || body.description || '').trim();
  const title = rawTitle || titleFromAskContent(rawBody || String(body.recommendation || ''));
  if (!title) return json({ error: 'title or question required' }, { status: 400 });

  const status = normalizeAskStatus(body.status, 'open');
  const ownerKind = normalizeAskOwnerKind(body.owner_kind ?? body.ownerKind, 'room');
  const priority = normalizeAskPriority(body.priority, 'normal');
  const assignedTo = String(body.assigned_to || body.assignedTo || body.audience || ownerKind || 'room').trim() || 'room';
  const meta = parseJsonObject(body.meta);
  const sourceMessageId = typeof body.source_message_id === 'string'
    ? body.source_message_id
    : typeof body.sourceMessageId === 'string'
      ? body.sourceMessageId
      : null;

  const id = createAskId();
  queries.createAsk(
    id,
    event.params.id,
    sourceMessageId,
    title,
    rawBody,
    typeof body.recommendation === 'string' && body.recommendation.trim() ? body.recommendation.trim() : null,
    status,
    assignedTo,
    ownerKind,
    priority,
    typeof body.created_by === 'string' ? body.created_by : typeof body.createdBy === 'string' ? body.createdBy : null,
    body.inferred ? 1 : 0,
    Number(body.confidence ?? 0) || 0,
    JSON.stringify({ ...meta, source: meta.source ?? 'manual' }),
  );

  const ask = publicAsk(queries.getAsk(id));
  emitAskRunEvent('ask_created', ask);
  const { broadcast, broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcast(event.params.id, { type: 'ask_created', sessionId: event.params.id, ask });
  broadcastGlobal({ type: 'ask_created', sessionId: event.params.id, ask });

  return json({ ask }, { status: 201 });
}
