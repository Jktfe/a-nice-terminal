import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { ChatRoom } from '$lib/server/chatRoomStore';
import type { ChatMessage } from '$lib/server/chatMessageStore';
import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
import type { AgentEvent } from '$lib/server/agentTimelineStore';
import type { SharedFile } from '$lib/server/chatAttachmentStore';
import type { Ask } from '$lib/server/askStore';
import type { TaskForRoom } from '$lib/server/taskStore';
import type { FocusEntry } from '$lib/server/focusModeStore';
import type { RoomMode } from '$lib/server/roomModesStore';

type SharedFileMetadata = Omit<SharedFile, 'contentsBase64'>;
type AsksFetchResult = { asks: Ask[]; asksFetchFailed: boolean };
type RoomModeFetchResult = { mode: RoomMode };
type ResponderFetchResult = {
  responders: {
    id: number;
    terminal_id: string;
    order_index: number;
    handle: string;
    pane_status: 'unknown' | 'verified' | 'stale';
  }[];
};
type MessagesFetchResult = {
  messages: ChatMessage[];
  paging?: {
    limit: number;
    before: number | null;
    hasMore: boolean;
    nextBefore: number | null;
  };
};

export const load: PageLoad = async ({ fetch, params }) => {
  const roomResponse = await fetch(`/api/chat-rooms/${params.roomId}`);
  if (roomResponse.status === 404) throw error(404, 'Room not found.');
  if (!roomResponse.ok) throw error(500, 'Could not fetch room.');

  const roomBody = (await roomResponse.json()) as { chatRoom: ChatRoom };

  // Per-room browser_session rebind lives in +page.svelte's onMount —
  // putting it here was unreliable: SvelteKit runs load() server-side on
  // initial visits (where the rebind POST would 403 on same-origin),
  // and gating on browser meant the SSR-then-hydrate path skipped the
  // POST entirely. onMount runs in the browser on every fresh room view
  // and on every route remount.

  const [messagesBody, aliasesBody, agentEventsBody, attachmentsBody, asksBody, plansBody, tasksBody, focusBody, roomModeBody, respondersBody, allRoomsBody] =
    await Promise.all([
      // Emergency cap: 10 messages until we virtualise the message list.
      // Larger limits compound with markdown rendering + per-row
      // components to lock the main thread. Use the "Load earlier"
      // button to scroll further back.
      fetch(`/api/chat-rooms/${params.roomId}/messages?limit=10`).then(async (response) =>
        response.ok
          ? ((await response.json()) as MessagesFetchResult)
          : { messages: [] as ChatMessage[], paging: { limit: 10, before: null, hasMore: false, nextBefore: null } }
      ),
      fetch(`/api/chat-rooms/${params.roomId}/aliases`).then(async (response) =>
        response.ok
          ? ((await response.json()) as { aliases: RoomAliasEntry[] })
          : { aliases: [] as RoomAliasEntry[] }
      ),
      fetch(`/api/chat-rooms/${params.roomId}/agent-events`).then(async (response) =>
        response.ok
          ? ((await response.json()) as { agentEvents: AgentEvent[] })
          : { agentEvents: [] as AgentEvent[] }
      ),
      fetch(`/api/chat-rooms/${params.roomId}/attachments`).then(async (response) =>
        response.ok
          ? ((await response.json()) as { sharedFiles: SharedFileMetadata[] })
          : { sharedFiles: [] as SharedFileMetadata[] }
      ),
      // Per @evolveantcodex M22 boundary: room-scoped asks come from the
      // accepted slice 1 endpoint with ?roomId=, soft-failed independently.
      fetch(`/api/asks?roomId=${encodeURIComponent(params.roomId)}&openOnly=1`).then(
        async (response): Promise<AsksFetchResult> =>
          response.ok
            ? {
                asks: ((await response.json()) as { asks: Ask[] }).asks,
                asksFetchFailed: false
              }
            : { asks: [], asksFetchFailed: true }
      ),
      // M:N plan↔rooms bidirectional read. Returns plans attached to this
      // room with live completion rollup (planCompletion at read time).
      // Soft-fails to empty list so the room page still loads if the
      // junction-store probe fails.
      fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/plans`).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as {
                plans: {
                  planId: string;
                  attachedAtMs: number;
                  attachedBy: string | null;
                  completion: {
                    planId: string;
                    title: string | null;
                    total: number;
                    completed: number;
                    pct: number;
                  };
                }[];
              })
            : { plans: [] }
      ),
      // #54 read-only tasks: plan-linked + standalone for this room.
      fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/tasks`).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as { tasks: TaskForRoom[] })
            : { tasks: [] as TaskForRoom[] }
      ),
      // #78 focus mode: active focused members in this room.
      fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/focus-mode`).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as { focusedMembers: FocusEntry[] })
            : { focusedMembers: [] as FocusEntry[] }
      ),
      // M3.b.4 room modes are persisted separately from the room row.
      // Load them with the rest of the room view data so heads-down
      // claim chips and controls use the actual room mode on first paint.
      fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/mode`).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as RoomModeFetchResult)
            : { mode: 'brainstorm' as RoomMode }
      ),
      fetch(`/api/chat-rooms/${encodeURIComponent(params.roomId)}/responders`).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as ResponderFetchResult)
            : { responders: [] }
      ),
      // RoomQuickNav left-rail label source. SSR-loaded as part of this
      // page's existing Promise.all so the rail can render starred-room
      // names directly from data props — no client-side fetch, no
      // $effect-merge pattern that bit us in the 7321315 + 4453308
      // regression. /api/chat-rooms returns ACTIVE rooms only, so an
      // archived starred room is silently absent from this map and the
      // rail simply omits it (per JWPK msg_u2ca1h86a5).
      fetch('/api/chat-rooms').then(async (response) =>
        response.ok
          ? ((await response.json()) as { chatRooms: { id: string; name: string }[] })
          : { chatRooms: [] as { id: string; name: string }[] }
      )
    ]);

  // Bring-in-App (gap #6b, JWPK msg_a0s51ioct6 2026-05-25): read the
  // `bring_in_app_ux` feature flag once per page load. Soft-fails to
  // false so the row collapses to the locked-state affordance if the
  // capabilities endpoint is unreachable — never blocks room load.
  const capabilitiesResponse = await fetch('/api/capabilities').catch(() => null);
  let bringInAppAvailable = false;
  // The operator's structural handle (configured server-side via
  // ANT_OPERATOR_HANDLE). Threaded to the composer as `asHandle` so the
  // browser mints + posts under the same handle the server stores — the
  // client never hardcodes the `@you` sentinel. Falls back to @JWPK if
  // capabilities is unreachable so user-facing identity stays clean.
  let operatorHandle = '@JWPK';
  if (capabilitiesResponse?.ok) {
    const body = (await capabilitiesResponse.json()) as {
      featureFlags?: Record<string, boolean>;
      operatorHandle?: string;
    };
    bringInAppAvailable = body.featureFlags?.bring_in_app_ux === true;
    if (typeof body.operatorHandle === 'string' && body.operatorHandle.length > 0) {
      operatorHandle = body.operatorHandle;
    }
  }

  const allRoomLabels: Record<string, string> = {};
  for (const room of allRoomsBody.chatRooms) {
    if (room.id && room.name) allRoomLabels[room.id] = room.name;
  }

  return {
    room: roomBody.chatRoom,
    messages: messagesBody.messages,
    messagePaging: messagesBody.paging ?? { limit: 10, before: null, hasMore: false, nextBefore: null },
    aliases: aliasesBody.aliases,
    agentEvents: agentEventsBody.agentEvents,
    sharedFiles: attachmentsBody.sharedFiles,
    asks: asksBody.asks,
    asksFetchFailed: asksBody.asksFetchFailed,
    plansForRoom: plansBody.plans,
    tasksForRoom: (tasksBody as { tasks: TaskForRoom[] }).tasks,
    focusedMembers: (focusBody as { focusedMembers: FocusEntry[] }).focusedMembers,
    roomMode: roomModeBody.mode,
    responders: (respondersBody as ResponderFetchResult).responders,
    allRoomLabels,
    bringInAppAvailable,
    asHandle: operatorHandle
  };
};
