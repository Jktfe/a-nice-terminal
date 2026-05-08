import { queries } from './db.js';
import { listDecks } from './decks.js';
import { listSheets } from './sheets.js';
import { listPlanRefs } from './projector/plan-view.js';
import {
  countRoomArtefacts,
  emptyRoomArtefacts,
  type RoomArtefactGroups,
  type RoomArtefactItem,
  type RoomArtefactSummary,
} from '$lib/shared/room-artefacts.js';

const DOC_PREFIX = 'docs/';

type SessionRow = {
  id: string;
  name: string;
  type: string;
  linked_chat_id?: string | null;
};

function parseDocMeta(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveArtefactRoom(sessionId: string): { session: SessionRow; room: SessionRow | null } | null {
  const session = queries.getSession(sessionId) as SessionRow | undefined;
  if (!session) return null;
  if (session.type === 'chat') return { session, room: session };

  const linkedChatId = typeof session.linked_chat_id === 'string' ? session.linked_chat_id : '';
  if (linkedChatId) {
    const linked = queries.getSession(linkedChatId) as SessionRow | undefined;
    if (linked?.type === 'chat') return { session, room: linked };
  }

  return { session, room: null };
}

function planItems(roomId: string): RoomArtefactItem[] {
  // Default: hide archived plans from the room artefacts panel.
  // Remote ANTs invited into a room shouldn't be greeted with stale
  // superseded plans (interview-realtime, status-parity, plan-management
  // etc. that we've archived). Power users can still reach archived
  // plans via /plan?include_archived=1 — that surface owns the archived
  // toggle. The room sidebar is for "what's relevant right now".
  return listPlanRefs(200, { includeArchived: false })
    .filter((plan) => plan.session_id === roomId)
    .map((plan) => ({
      id: plan.plan_id,
      kind: 'plan' as const,
      room_id: roomId,
      title: plan.plan_id,
      href: `/plan?session_id=${encodeURIComponent(plan.session_id)}&plan_id=${encodeURIComponent(plan.plan_id)}${plan.archived ? '&include_archived=1' : ''}`,
      status: plan.archived ? 'archived' : plan.status ?? 'live',
      subtitle: `${plan.event_count} event${plan.event_count === 1 ? '' : 's'}`,
      updated_at: plan.updated_ts_ms,
      meta: {
        event_count: plan.event_count,
        archived: plan.archived,
      },
    }));
}

function deckItems(roomId: string): RoomArtefactItem[] {
  return listDecks()
    .filter((deck) => deck.allowed_room_ids.includes(roomId))
    .map((deck) => ({
      id: deck.slug,
      kind: 'deck' as const,
      room_id: roomId,
      title: deck.title,
      href: `/deck/${encodeURIComponent(deck.slug)}/`,
      status: 'linked',
      subtitle: deck.dev_port ? `dev port ${deck.dev_port}` : null,
      updated_at: deck.updated_at,
      meta: {
        slug: deck.slug,
        owner_session_id: deck.owner_session_id,
      },
    }));
}

function sheetItems(roomId: string): RoomArtefactItem[] {
  return listSheets()
    .filter((sheet) => sheet.allowed_room_ids.includes(roomId))
    .map((sheet) => ({
      id: sheet.slug,
      kind: 'sheet' as const,
      room_id: roomId,
      title: sheet.title,
      href: `/api/sheets/${encodeURIComponent(sheet.slug)}/files`,
      status: 'linked',
      subtitle: sheet.dev_port ? `dev port ${sheet.dev_port}` : null,
      updated_at: sheet.updated_at,
      meta: {
        slug: sheet.slug,
        owner_session_id: sheet.owner_session_id,
      },
    }));
}

function docItems(roomId: string): RoomArtefactItem[] {
  const rows = queries.listMemoriesByPrefix(DOC_PREFIX, 200) as Array<{
    key?: string | null;
    value?: string | null;
    tags?: string | null;
    session_id?: string | null;
    created_by?: string | null;
    updated_at?: string | null;
  }>;

  return rows
    .filter((row) => row.session_id === roomId)
    .filter((row) => {
      const docId = String(row.key ?? '').replace(DOC_PREFIX, '');
      return docId.length > 0 && !docId.includes('/');
    })
    .map((row) => {
      const docId = String(row.key).replace(DOC_PREFIX, '');
      const meta = parseDocMeta(row.value);
      const title = stringValue(meta.title) ?? docId;
      const status = stringValue(meta.status) ?? 'draft';
      const description = stringValue(meta.description);
      return {
        id: docId,
        kind: 'doc' as const,
        room_id: roomId,
        title,
        href: `/api/docs/${encodeURIComponent(docId)}?session_id=${encodeURIComponent(roomId)}`,
        status,
        subtitle: description,
        updated_at: row.updated_at ?? null,
        meta: {
          key: row.key,
          room_id: roomId,
          created_by: row.created_by ?? null,
        },
      };
    });
}

export function listRoomArtefacts(sessionId: string): RoomArtefactSummary | null {
  const resolved = resolveArtefactRoom(sessionId);
  if (!resolved) return null;
  if (!resolved.room) return emptyRoomArtefacts(sessionId, sessionId, resolved.session.id);

  const roomId = resolved.room.id;
  const artefacts: RoomArtefactGroups = {
    plans: planItems(roomId),
    decks: deckItems(roomId),
    docs: docItems(roomId),
    sheets: sheetItems(roomId),
  };

  return {
    session_id: sessionId,
    room_id: roomId,
    source_session_id: resolved.session.id === roomId ? null : resolved.session.id,
    artefacts,
    counts: countRoomArtefacts(artefacts),
  };
}
