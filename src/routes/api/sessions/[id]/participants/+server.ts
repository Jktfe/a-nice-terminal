import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope';

function resolveCliFlag(session: any): string | null {
  if (session.cli_flag) return session.cli_flag;
  try {
    return JSON.parse(session.meta || '{}').agent_driver || null;
  } catch {
    return null;
  }
}

function parseTtlSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(60, Math.min(Math.floor(value), 7200));
  if (typeof value !== 'string') return 1800;
  const raw = value.trim().toLowerCase();
  const match = raw.match(/^(\d+)(s|m|h)?$/);
  if (!match) return 1800;
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const seconds = unit === 'h' ? amount * 3600 : unit === 'm' ? amount * 60 : amount;
  return Math.max(60, Math.min(seconds, 7200));
}

function attentionPayload(roomId: string, member: any) {
  return {
    attention_state: member.attention_state || 'available',
    attention_reason: member.attention_reason || null,
    attention_set_by: member.attention_set_by || null,
    attention_expires_at: member.attention_expires_at || null,
    attention_updated_at: member.attention_updated_at || null,
    focus_queue_count: queries.countFocusQueue(roomId, member.session_id),
  };
}

function normaliseHandle(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function activeRoomTokenParticipants(roomId: string, existing: any[]): any[] {
  const seen = new Set<string>();
  for (const item of existing) {
    const handle = normaliseHandle(item?.handle || item?.alias);
    if (handle) seen.add(handle.toLowerCase());
  }

  const remote: any[] = [];
  for (const invite of queries.listRoomInvites(roomId) as any[]) {
    if (invite.revoked_at) continue;
    for (const token of queries.listRoomTokens(invite.id) as any[]) {
      if (token.revoked_at || token.room_id !== roomId) continue;
      // Read-only web/deck-viewer tokens are feature/viewer access, not
      // talk-capable room participants. Keep them out of Participants and
      // @mention autocomplete; artefact links surface them where relevant.
      if (token.kind === 'web') continue;
      const handle = normaliseHandle(token.handle);
      if (!handle) continue;
      if (!/^@[\w.-]+$/.test(handle)) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      remote.push({
        id: `remote:${handle.slice(1).toLowerCase()}`,
        name: handle,
        handle,
        alias: handle,
        session_type: 'remote',
        session_status: token.last_seen_at ? 'connected' : null,
        cli_flag: token.kind || null,
        role: 'remote',
        joined_at: token.created_at,
        attention_state: 'available',
        attention_reason: null,
        attention_set_by: null,
        attention_expires_at: null,
        attention_updated_at: token.last_seen_at || null,
        focus_queue_count: 0,
        first_seen: token.created_at,
        last_seen: token.last_seen_at || token.created_at,
        message_count: 0,
      });
    }
  }
  return remote;
}

export function GET({ params, url }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) return json({ error: 'not found' }, { status: 404 });

  // Phase 6: Return structured participants from chat_room_members if available,
  // falling back to message-derived participants for backwards compatibility.
  const roomMembers: any[] = queries.listRoomMembers(params.id);

  if (roomMembers.length > 0) {
    const includeCounts = url?.searchParams.get('include_counts') === '1';
    const msgCountMap = includeCounts
      ? new Map((queries.listParticipants(params.id) as any[]).map((p: any) => [p.id, p]))
      : new Map<string, any>();

    // Modern rooms already have explicit membership. Avoid the legacy
    // message-derived enrichment query on this hot path; mobile only needs the
    // participant identities, and message counts are derived client-side from
    // the bounded message window.
    const participants = roomMembers
      .filter((m: any) => m.role === 'participant')
      .map((m: any) => {
        const msgData = msgCountMap.get(m.session_id);
        return {
          id: m.session_id,
          name: m.display_name || m.name || m.session_id,
          handle: m.handle,
          alias: m.alias,
          session_type: m.type,
          session_status: m.session_status || null,
          cli_flag: m.cli_flag,
          role: m.role,
          joined_at: m.joined_at,
          ...attentionPayload(params.id, m),
          first_seen: msgData?.first_seen ?? null,
          last_seen: msgData?.last_seen ?? null,
          message_count: msgData?.message_count ?? 0,
        };
      });

    const postsFrom = roomMembers
      .filter((m: any) => m.role === 'external')
      .map((m: any) => {
        const msgData = msgCountMap.get(m.session_id);
        return {
          id: m.session_id,
          name: m.display_name || m.name || m.session_id,
          handle: m.handle,
          alias: m.alias,
          cli_flag: m.cli_flag,
          role: m.role,
          joined_at: m.joined_at,
          ...attentionPayload(params.id, m),
          first_seen: msgData?.first_seen ?? null,
          last_seen: msgData?.last_seen ?? null,
          message_count: msgData?.message_count ?? 0,
        };
      });

    const remoteInvitees = activeRoomTokenParticipants(params.id, [...participants, ...postsFrom]);

    return json({
      participants,
      postsFrom: [...postsFrom, ...remoteInvitees],
      all: [...participants, ...postsFrom, ...remoteInvitees],
    });
  }

  // Fallback: no room members yet, use message-derived participants
  const messageDerived = queries.listParticipants(params.id);
  const remoteInvitees = activeRoomTokenParticipants(params.id, messageDerived);
  return json({
    participants: messageDerived,
    postsFrom: remoteInvitees,
    all: [...messageDerived, ...remoteInvitees],
  });
}

export async function POST(event: RequestEvent<{ id: string }>) {
  // Adding arbitrary participants is admin-only. Guests get auto-added on
  // their first message send (via the message router), so they don't need
  // direct access to this endpoint.
  assertNotRoomScoped(event);
  const { params, request } = event;
  const room = queries.getSession(params.id);
  if (!room) return json({ error: 'not found' }, { status: 404 });
  if (room.type !== 'chat') return json({ error: 'room must be a chat session' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const rawSessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const rawHandle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const role = body.role === 'external' ? 'external' : 'participant';

  if (!rawSessionId && !rawHandle) {
    return json({ error: 'session_id or handle required' }, { status: 400 });
  }

  const member = rawSessionId
    ? queries.getSession(rawSessionId)
    : queries.getSessionByHandle(rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`);

  if (!member) return json({ error: 'member session not found' }, { status: 404 });

  const aliasInput = typeof body.alias === 'string' ? body.alias.trim() : '';
  const alias = aliasInput || member.handle || null;
  const cliFlag = resolveCliFlag(member);
  queries.addRoomMember(params.id, member.id, role, cliFlag, alias);
  if (alias) queries.updateMemberAlias(params.id, member.id, alias);

  const added = (queries.listRoomMembers(params.id) as any[]).find((m: any) => m.session_id === member.id);
  return json({
    id: member.id,
    name: member.display_name || member.name || member.id,
    handle: member.handle,
    alias: added?.alias ?? alias,
    session_type: member.type,
    role,
    cli_flag: added?.cli_flag ?? cliFlag,
    joined_at: added?.joined_at ?? null,
    ...(added ? attentionPayload(params.id, added) : {}),
  }, { status: 201 });
}

export async function PATCH(event: RequestEvent<{ id: string }>) {
  // Attention/focus PATCH is currently admin-only. Self-focus from a remote
  // ANT is a sensible follow-up but needs identity-binding (token → handle
  // → session_id) before we can verify "actor is acting on themselves".
  assertNotRoomScoped(event);
  const { params, request } = event;
  const room = queries.getSession(params.id);
  if (!room) return json({ error: 'not found' }, { status: 404 });
  if (room.type !== 'chat') return json({ error: 'room must be a chat session' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const rawSessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const rawHandle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const requestedState = body.attention_state === 'focus' ? 'focus' : 'available';
  const actor = typeof body.set_by === 'string' && body.set_by.trim() ? body.set_by.trim() : null;
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  if (!rawSessionId && !rawHandle) {
    return json({ error: 'session_id or handle required' }, { status: 400 });
  }

  const memberSession = rawSessionId
    ? queries.getSession(rawSessionId)
    : queries.getSessionByHandle(rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`);
  if (!memberSession) return json({ error: 'member session not found' }, { status: 404 });

  const member = queries.getRoomMember(params.id, (memberSession as any).id) as any;
  if (!member || member.role === 'left') return json({ error: 'member is not in this room' }, { status: 404 });

  if (requestedState === 'focus') {
    const isSelfSet = actor && (actor === member.session_id || actor === member.handle || actor === member.alias);
    if (!isSelfSet && !reason) {
      return json({ error: 'reason required when setting another participant into focus mode' }, { status: 400 });
    }
    const ttlSeconds = parseTtlSeconds(body.ttl ?? body.ttl_seconds ?? body.duration ?? '30m');
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    queries.setMemberAttention(params.id, member.session_id, 'focus', reason, actor, expiresAt);

    const { getRouter } = await import('$lib/server/message-router.js');
    (getRouter() as any).postFocusRoomEvent?.(
      params.id,
      'focus_status',
      `${member.alias || member.handle || member.name || member.session_id} entered focus mode for ${Math.round(ttlSeconds / 60)}m${reason ? `: ${reason}` : ''}.`,
      actor,
      { focus: { action: 'enter', target_session_id: member.session_id, target: member.alias || member.handle || null, reason, ttl_seconds: ttlSeconds } },
    );

    const updated = queries.getRoomMember(params.id, member.session_id) as any;
    return json({ ok: true, id: member.session_id, ...attentionPayload(params.id, updated) });
  }

  const { getRouter } = await import('$lib/server/message-router.js');
  const result = await getRouter().releaseFocus(params.id, member.session_id, actor, reason, 'manual');
  const updated = queries.getRoomMember(params.id, member.session_id) as any;
  return json({ ok: true, id: member.session_id, ...attentionPayload(params.id, updated), digest: result });
}

export async function DELETE(event: RequestEvent<{ id: string }>) {
  // Kicking participants is admin-only. Self-leave for guests is a planned
  // follow-up — for now, revoke the bearer's invite to evict them.
  assertNotRoomScoped(event);
  const { params, url, request } = event;
  const room = queries.getSession(params.id);
  if (!room) return json({ error: 'not found' }, { status: 404 });
  if (room.type !== 'chat') return json({ error: 'room must be a chat session' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const bodySessionId = typeof body.session_id === 'string' ? body.session_id : '';
  const bodyHandle = typeof body.handle === 'string' ? body.handle : '';
  const rawSessionId = (url.searchParams.get('session_id') || bodySessionId).trim();
  const rawHandle = (url.searchParams.get('handle') || bodyHandle).trim();

  if (!rawSessionId && !rawHandle) {
    return json({ error: 'session_id or handle required' }, { status: 400 });
  }

  const member = rawSessionId
    ? queries.getSession(rawSessionId)
    : queries.getSessionByHandle(rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`);

  if (!member) return json({ error: 'member session not found' }, { status: 404 });

  const result = queries.removeRoomMember(params.id, member.id) as { changes?: number };

  const { broadcastGlobal } = await import('$lib/server/ws-broadcast.js');
  broadcastGlobal({ type: 'sessions_changed' });

  return json({
    ok: true,
    removed: (result.changes ?? 0) > 0,
    id: member.id,
  });
}
