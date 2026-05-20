<!--
  Room view route — chat is the body, context lives in a single
  RoomMenuDropdown above (D1.6-T1b reshape per JWPK D2.7).
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { subscribeToRoomEvents, type RealtimeRoomHandle } from '$lib/stores/realtimeRoom.svelte';
  import InviteAgentForm from '$lib/components/InviteAgentForm.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import ChatComposer from '$lib/components/ChatComposer.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ParticipantsPanel from '$lib/components/ParticipantsPanel.svelte';
  import ParticipantDetailSheet from '$lib/components/ParticipantDetailSheet.svelte';
  import ChangeHandleForm from '$lib/components/ChangeHandleForm.svelte';
  import ParticipantPresentationForm from '$lib/components/ParticipantPresentationForm.svelte';
  import AliasAppliedBanner from '$lib/components/AliasAppliedBanner.svelte';
  import RemoveMemberFlow from '$lib/components/RemoveMemberFlow.svelte';
  import AgentTimeline from '$lib/components/AgentTimeline.svelte';
  import AttachmentsTray from '$lib/components/AttachmentsTray.svelte';
  import UploadFileButton from '$lib/components/UploadFileButton.svelte';
  import InteractiveAsksPanel from '$lib/components/InteractiveAsksPanel.svelte';
  import RoomMemoryLauncher from '$lib/components/RoomMemoryLauncher.svelte';
  import CollapsibleSection from '$lib/components/CollapsibleSection.svelte';
  import RoomMenuDropdown from '$lib/components/RoomMenuDropdown.svelte';
  import RoomNameHeader from '$lib/components/RoomNameHeader.svelte';
  import RoomPlansPanel from '$lib/components/RoomPlansPanel.svelte';
  import RoomTasksPanel from '$lib/components/RoomTasksPanel.svelte';
  import RoomLinksPanel from '$lib/components/RoomLinksPanel.svelte';
  import FocusModeModal from '$lib/components/FocusModeModal.svelte';
  import BreakConfirmModal from '$lib/components/BreakConfirmModal.svelte';
  import InterviewsRoomPanel from '$lib/components/InterviewsRoomPanel.svelte';
  import RoomQuickNav from '$lib/components/RoomQuickNav.svelte';
  import { roomSidePanelPins } from '$lib/stores/roomSidePanelPins.svelte';
  import ScreenshotsRoomPanel from '$lib/components/ScreenshotsRoomPanel.svelte';
  import ArtefactsRoomPanel from '$lib/components/ArtefactsRoomPanel.svelte';
  import RoomDigestPanel from '$lib/components/RoomDigestPanel.svelte';
  import AgentStatusFooter from '$lib/components/AgentStatusFooter.svelte';
  import { mergeQuietMessageFeed } from '$lib/chat/quietMessageFeed';
  import { ensureBrowserSessionForRoom } from '$lib/browserSessionClient';
  import type { ChatRoom, RoomMember } from '$lib/server/chatRoomStore';
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { AgentEvent } from '$lib/server/agentTimelineStore';
  import type { SharedFile } from '$lib/server/chatAttachmentStore';
  import type { Ask } from '$lib/server/askStore';
  import type { TaskForRoom } from '$lib/server/taskStore';
  import type { FocusEntry } from '$lib/server/focusModeStore';

  type DetailSheetMode = 'actions' | 'changeHandle' | 'presentation';
  type SheetAction = 'change-handle' | 'edit-presentation' | 'view-activity' | 'set-focus' | 'remove' | 'close';
  type SharedFileMetadata = Omit<SharedFile, 'contentsBase64'>;

  type RoomPlanLink = {
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
  };
  type RoomPageData = {
    room: ChatRoom;
    messages: ChatMessage[];
    messagePaging?: {
      limit: number;
      before: number | null;
      hasMore: boolean;
      nextBefore: number | null;
    };
    aliases: RoomAliasEntry[];
    agentEvents: AgentEvent[];
    sharedFiles: SharedFileMetadata[];
    asks: Ask[];
    asksFetchFailed: boolean;
    plansForRoom: RoomPlanLink[];
    tasksForRoom: TaskForRoom[];
    focusedMembers: FocusEntry[];
    allRoomLabels?: Record<string, string>;
  };
  type Props = { data: RoomPageData };

  let { data }: Props = $props();

  // Messages keep a quiet client merge layer so posts do not replace the list.
  const roomFromServer = $derived<ChatRoom>(data.room);
  const messagesFromServer = $derived<ChatMessage[]>(data.messages);
  const aliasesInRoom = $derived<RoomAliasEntry[]>(data.aliases);
  const agentEventsFromServer = $derived<AgentEvent[]>(data.agentEvents ?? []);
  // #76 — find the caller's most recent editable message in this room
  // so ↑ in an empty composer loads it. Walk from the newest backwards,
  // skip system kinds + deleted rows. asHandle defaults to @you.
  // Fall back to @you when the page data hasn't surfaced a caller handle —
  // matches the ChatComposer's own default.
  const callerHandle = $derived(
    (data as { asHandle?: string }).asHandle ?? '@you'
  );
  const lastOwnEditableMessage = $derived.by(() => {
    const list = (liveMessageRoomId === null ? messagesFromServer : liveMessages) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (m.authorHandle !== callerHandle) continue;
      if (m.kind !== 'human' && m.kind !== 'agent') continue;
      if (m.deletedAtMs) continue;
      return m;
    }
    return undefined;
  });
  const sharedFilesFromServer = $derived<SharedFileMetadata[]>(data.sharedFiles ?? []);
  const asksFromServer = $derived<Ask[]>(data.asks ?? []);
  const asksFetchFailed = $derived<boolean>(data.asksFetchFailed ?? false);
  const plansForRoom = $derived<RoomPlanLink[]>(data.plansForRoom ?? []);
  const tasksForRoom = $derived<TaskForRoom[]>(data.tasksForRoom ?? []);
  const primaryRoomPlanHref = $derived(
    plansForRoom[0]?.planId
      ? `/plans/${encodeURIComponent(plansForRoom[0].planId)}`
      : '/plans'
  );
  const focusedMembers = $derived<FocusEntry[]>(data.focusedMembers ?? []);
  const focusableMembers = $derived(
    roomFromServer.members.filter((member) => member.kind === 'agent')
  );

  // Side-panel pin state — which section ids are pinned to the right
  // rail for THIS room. Each section's snippet renders into either the
  // RoomMenuDropdown (when NOT pinned) or the .room-context-rail aside
  // (when pinned), exclusive — so each panel mounts exactly once.
  //
  // Hydrate the store from localStorage on mount with a stable roomId
  // snapshot. The store's reads (getPinsForRoom / isPinned) are pure,
  // so $derived consumers can call them without triggering the
  // "$state writes during $derived eval are silently dropped" Svelte 5
  // gotcha — the banked d51b0c3 / f4125ff regression class. SvelteKit
  // remounts +page.svelte across room-route navigation, so onMount
  // fires for each room visit.
  // Collapsible L/R panes (JWPK msg_1rmpt6ozub + msg_xyrlvisazp,
  // 2026-05-19). Per-device localStorage so the operator's preference
  // sticks across rooms + reloads. Keyboard shortcuts: '[' toggles left,
  // ']' toggles right (when not in an input/textarea so typing isn't
  // hijacked). aria-expanded on the toggle buttons drives screen readers.
  const LEFT_PANE_KEY = 'ant.rooms.leftPaneCollapsed';
  const RIGHT_PANE_KEY = 'ant.rooms.rightPaneCollapsed';
  let leftPaneCollapsed = $state(false);
  let rightPaneCollapsed = $state(false);

  function toggleLeftPane(): void {
    leftPaneCollapsed = !leftPaneCollapsed;
    try { localStorage.setItem(LEFT_PANE_KEY, String(leftPaneCollapsed)); } catch { /* private-mode safe */ }
  }
  function toggleRightPane(): void {
    rightPaneCollapsed = !rightPaneCollapsed;
    try { localStorage.setItem(RIGHT_PANE_KEY, String(rightPaneCollapsed)); } catch { /* private-mode safe */ }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function handlePaneShortcut(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === '[') {
      e.preventDefault();
      toggleLeftPane();
    } else if (e.key === ']') {
      e.preventDefault();
      toggleRightPane();
    }
  }

  let lastBrowserSessionRebindKey = $state('');
  $effect(() => {
    const roomId = roomFromServer.id;
    const authorHandle = callerHandle.trim();
    if (roomId.length === 0 || authorHandle.length === 0) return;
    const key = `${roomId}:${authorHandle}`;
    if (key === lastBrowserSessionRebindKey) return;
    lastBrowserSessionRebindKey = key;
    // Per-room browser_session rebind. The cookie is path-scoped
    // (Path=/api/chat-rooms/<roomId>), so each room id needs its own mint.
    // This must be keyed on room id, not only onMount: SvelteKit can reuse
    // this route component across client-side room navigation.
    void ensureBrowserSessionForRoom({ roomId, authorHandle, force: true });
  });

  onMount(() => {
    try {
      leftPaneCollapsed = localStorage.getItem(LEFT_PANE_KEY) === 'true';
      rightPaneCollapsed = localStorage.getItem(RIGHT_PANE_KEY) === 'true';
    } catch { /* private-mode safe */ }
    window.addEventListener('keydown', handlePaneShortcut);

    return () => window.removeEventListener('keydown', handlePaneShortcut);
  });

  // Per-room pin hydrate — must run on EVERY roomId change, not just
  // initial onMount. SvelteKit reuses this component across client-side
  // room navigation (/rooms/A → /rooms/B), so a single onMount init was
  // leaving the new room's pin set empty → pinned sections disappeared.
  // JWPK msg_yymzxywxwy: 'the pinned Right hand panel details disappear
  // WAY too frequently'. Banked pattern from the browserSessionRebind
  // effect above (line 183-192) — same shape, different store.
  let lastPinHydrateKey = $state<string | null>(null);
  $effect(() => {
    const key = roomFromServer.id;
    if (!key || key === lastPinHydrateKey) return;
    lastPinHydrateKey = key;
    roomSidePanelPins.init(key);
  });
  const pinnedSectionIds = $derived(roomSidePanelPins.getPinsForRoom(roomFromServer.id));
  function togglePinFor(sectionId: string): void {
    roomSidePanelPins.togglePin(roomFromServer.id, sectionId);
  }

  let detailSheetMember = $state<RoomMember | null>(null);
  let detailSheetMode = $state<DetailSheetMode>('actions');
  let appliedBanner = $state<{ globalHandle: string; alias: string } | null>(null);
  let memberPendingRemoval = $state<RoomMember | null>(null);
  let showFocusModal = $state(false);
  let focusModalTarget = $state<string | null>(null);
  let breakReason = $state('');
  let showBreakModal = $state(false);
  let showDigestPanel = $state(false);
  let exitingFocusHandle = $state<string | null>(null);
  // M30 slice 3b: reply target from MessageRow Reply button.
  let replyingToMessageId = $state<string | null>(null);
  let liveMessages = $state<ChatMessage[]>([]);
  let liveMessageRoomId = $state<string | null>(null);
  let hasOlderMessages = $state(false);
  let loadingOlderMessages = $state(false);

  // GAP-55 effect-loop fix (2026-05-14): mergeQuietMessageFeed returns a
  // NEW array on every call so writing the merged result back to
  // liveMessages WOULD trigger another effect-fire (Svelte 5 tracks the
  // read in the call argument). Wrapping the read in `untrack` snapshots
  // the current liveMessages WITHOUT subscribing, so the write doesn't
  // re-trigger this same effect → no effect_update_depth_exceeded loop.
  $effect(() => {
    if (liveMessageRoomId !== roomFromServer.id) {
      liveMessageRoomId = roomFromServer.id;
      liveMessages = messagesFromServer;
      hasOlderMessages = data.messagePaging?.hasMore ?? false;
      return;
    }
    liveMessages = mergeQuietMessageFeed(
      untrack(() => liveMessages),
      messagesFromServer
    );
  });

  function refreshFromServer() {
    return invalidateAll();
  }

  // GAP-55 T2-A SSE subscription (realtime-layer-design-contract 2026-05-14).
  // KEYED on the primitive room id (not the room object) so invalidateAll's
  // new data.room reference does NOT re-fire this effect. Cleanup ONLY
  // closes the handle — no realtime-state read/write inside cleanup so the
  // effect cannot self-retrigger. Effect-update-depth bug fix 2026-05-14.
  const currentRoomId = $derived(roomFromServer.id);
  let realtime = $state<RealtimeRoomHandle | null>(null);
  let lastEventCount = $state(0);
  const latestRealtimeEvent = $derived(realtime?.lastEvent ?? null);
  $effect(() => {
    // PATCH A: skip invalidateAll on the INITIAL onopen — data was already
    // fetched server-side and is on the page. Only invalidate on actual
    // reconnects (subsequent opens), where the client needs to catch up
    // on anything missed during the gap.
    let seenInitialOpen = false;
    const handle = subscribeToRoomEvents(currentRoomId, {
      onConnect: () => {
        if (!seenInitialOpen) { seenInitialOpen = true; return; }
        void invalidateAll();
      }
    });
    realtime = handle;
    lastEventCount = 0;
    return () => handle.close();
  });
  // Debounce invalidateAll on SSE event bursts. A flooded room (e.g. many
  // agents posting in parallel) was firing invalidateAll 5-10x/second,
  // re-fetching the page data each time and crashing browsers. Coalesce
  // bursts into one refresh per 750ms window.
  let pendingInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const count = realtime?.eventCount ?? 0;
    if (count > lastEventCount) {
      lastEventCount = count;
      if (pendingInvalidateTimer) clearTimeout(pendingInvalidateTimer);
      pendingInvalidateTimer = setTimeout(() => {
        pendingInvalidateTimer = null;
        void invalidateAll();
      }, 750);
    }
  });
  onDestroy(() => { realtime?.close(); });
  function setReplyingTo(messageId: string) {
    replyingToMessageId = messageId;
  }
  function clearReplyingTo() { replyingToMessageId = null; }
  function mergePostedMessageAndClearReply(message?: ChatMessage) {
    clearReplyingTo();
    if (message) liveMessages = mergeQuietMessageFeed(liveMessages, [message]);
  }

  async function loadOlderMessages() {
    if (loadingOlderMessages || !hasOlderMessages) return;
    const oldestPostOrder = liveMessages[0]?.postOrder;
    if (oldestPostOrder === undefined) return;
    loadingOlderMessages = true;
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomFromServer.id)}/messages?limit=100&before=${oldestPostOrder}`
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        messages: ChatMessage[];
        paging?: { hasMore: boolean; nextBefore: number | null };
      };
      liveMessages = mergeQuietMessageFeed(liveMessages, payload.messages);
      hasOlderMessages = payload.paging?.hasMore ?? false;
    } finally {
      loadingOlderMessages = false;
    }
  }

  function openMemberSheet(member: RoomMember) {
    detailSheetMember = member;
    detailSheetMode = 'actions';
  }

  function closeMemberSheet() {
    detailSheetMember = null;
    detailSheetMode = 'actions';
  }

  function handleSheetAction(action: SheetAction) {
    if (action === 'change-handle') {
      detailSheetMode = 'changeHandle';
      return;
    }
    if (action === 'edit-presentation') {
      detailSheetMode = 'presentation';
      return;
    }
    if (action === 'set-focus') {
      if (detailSheetMember) {
        focusModalTarget = detailSheetMember.handle;
        showFocusModal = true;
      }
      closeMemberSheet();
      return;
    }
    if (action === 'close') {
      closeMemberSheet();
      return;
    }
    if (action === 'remove') {
      memberPendingRemoval = detailSheetMember;
      closeMemberSheet();
    }
  }

  function handleMemberRemoved() {
    memberPendingRemoval = null;
    refreshFromServer();
  }

  function handleAliasApplied(savedAlias: string) {
    if (!detailSheetMember) return;
    appliedBanner = { globalHandle: detailSheetMember.handle, alias: savedAlias };
    closeMemberSheet();
    refreshFromServer();
  }

  function handlePresentationSaved() {
    closeMemberSheet();
    refreshFromServer();
  }

  function handleChangeHandleCancel() {
    detailSheetMode = 'actions';
  }

  function dismissBanner() {
    appliedBanner = null;
  }

  function findAliasForMember(globalHandle: string): string | undefined {
    return aliasesInRoom.find((entry) => entry.globalHandle === globalHandle)?.alias;
  }

  function focusInviteForm() {
    // D1.6-T1b reshape: invite is NESTED inside Participants section, which
    // lives inside the RoomMenuDropdown. Force-open all 3 levels before
    // scroll+focus so the input is in the layout tree.
    const menuDetails = document.getElementById('room-menu') as HTMLDetailsElement | null;
    if (menuDetails) menuDetails.open = true;
    const participantsDetails = document.getElementById('participants') as HTMLDetailsElement | null;
    if (participantsDetails) participantsDetails.open = true;
    const inviteSection = document.getElementById('inviteAgentSection') as HTMLDetailsElement | null;
    if (inviteSection) inviteSection.open = true;
    inviteSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const handleField = document.getElementById('agentHandleField') as HTMLInputElement | null;
    setTimeout(() => handleField?.focus(), 300);
  }

  function formatFocusWindow(entry: FocusEntry): string {
    if (entry.expiresAt === null) return 'Until pulled out';
    const expiryMs = new Date(entry.expiresAt).getTime();
    const remainingMinutes = Math.max(0, Math.ceil((expiryMs - Date.now()) / 60_000));
    if (remainingMinutes <= 1) return 'Ends in 1m';
    if (remainingMinutes < 60) return `Ends in ${remainingMinutes}m`;
    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    return minutes > 0 ? `Ends in ${hours}h ${minutes}m` : `Ends in ${hours}h`;
  }

  function labelForMember(handle: string): string {
    const member = roomFromServer.members.find((candidate) => candidate.handle === handle);
    return member?.displayName ?? handle;
  }

  async function exitFocus(memberHandle: string) {
    exitingFocusHandle = memberHandle;
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomFromServer.id)}/focus-mode`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberHandle })
      });
      if (response.ok) await invalidateAll();
    } finally {
      exitingFocusHandle = null;
    }
  }

  // Section catalog drives the right rail's pinned-section list. The
  // titles + ids match the CollapsibleSection definitions inside the
  // RoomMenuDropdown below. Used by the rail to label the pinned-jump
  // buttons (Phase A — quicklink-only). A Phase B follow-up will
  // promote pinned section CONTENT inline into the rail via the same
  // catalog + a per-section snippet ref.
  // Right-rail mutual-exclusion (JWPK msg_8j3yzijma0): when a section
  // is pinned, it renders ONLY in the rail (as its own collapsible
  // card the user can expand/contract in place). When unpinned, it
  // renders ONLY in the More dropdown. No double-mount, no inline
  // always-expanded content (the regression class of 1eb3c50). The
  // collapsed card defers panel-mount via CollapsibleSection's
  // hasBeenOpened lazy gate — fetch-heavy panels (artefacts/screenshots/
  // attachments/etc.) don't fire onMount fetches until the user
  // expands the card.
</script>

<svelte:head>
  <title>{roomFromServer.name} | ANT vNext</title>
</svelte:head>

<SimplePageShell showIntro={false}>
  <div class="room-grid" class:left-collapsed={leftPaneCollapsed} class:right-collapsed={rightPaneCollapsed}>
    <div class="left-pane">
      {#if !leftPaneCollapsed}
        <RoomQuickNav
          currentRoomId={roomFromServer.id}
          roomLabels={new Map(Object.entries(data.allRoomLabels ?? {}))}
        />
      {/if}
      <button
        type="button"
        class="pane-toggle pane-toggle-left"
        aria-label={leftPaneCollapsed ? 'Expand left pane (press [)' : 'Collapse left pane (press [)'}
        aria-expanded={!leftPaneCollapsed}
        title={leftPaneCollapsed ? 'Expand · [' : 'Collapse · ['}
        onclick={toggleLeftPane}
      >
        <svg viewBox="0 0 12 24" aria-hidden="true">
          {#if leftPaneCollapsed}
            <path d="M3 4 L9 12 L3 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <path d="M9 4 L3 12 L9 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {/if}
        </svg>
      </button>
    </div>
    <div class="room-main">
      <!-- The .room-main wraps the chat + room-content. The pinned-section
           quicklink rail mounts as a third grid column AFTER this div
           closes; pinnedSectionIds drives its visibility + content. -->


  {#if appliedBanner}
    <AliasAppliedBanner
      globalHandle={appliedBanner.globalHandle}
      alias={appliedBanner.alias}
      onDismiss={dismissBanner}
    />
  {/if}

  <!-- D1.6-T1b reshape: RoomNameHeader replaces SimplePageShell hero;
       RoomMenuDropdown holds context sections so chat gets full vertical
       real-estate. Invite agent is NESTED inside Participants per JWPK D2.7. -->

  <RoomNameHeader
    roomId={roomFromServer.id}
    roomName={roomFromServer.name}
    startedBy={roomFromServer.whoCreatedIt}
    lastUpdate={roomFromServer.lastUpdate}
  >
    {#snippet menu()}
      <RoomMenuDropdown summary="More" innerIds={['participants', 'focus', 'asks', 'plans', 'tasks', 'linked-rooms', 'interviews', 'artefacts', 'screenshots', 'memory', 'attachments']}>
    <nav class="discipline-links" aria-label="Room work surfaces">
      <a class="discipline-link" href={`/asks?roomId=${roomFromServer.id}`}>Asks</a>
      <a class="discipline-link" href={primaryRoomPlanHref}>Plan</a>
      <a class="discipline-link" href="#tasks">Tasks</a>
    </nav>

    {#if !pinnedSectionIds.has('participants')}
    <CollapsibleSection id="participants" title="Participants" count={roomFromServer.members.length} pinRoomId={roomFromServer.id}>
      <ParticipantsPanel
        roomId={roomFromServer.id}
        members={roomFromServer.members}
        {aliasesInRoom}
        {focusedMembers}
        onMemberPicked={openMemberSheet}
        onInviteRequested={focusInviteForm}
      />
      <details id="inviteAgentSection" class="nested-invite-toggle">
        <summary class="nested-invite-summary">
          <span class="nested-invite-label">Invite an agent</span>
          <span class="nested-invite-chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="nested-invite-body">
          <InviteAgentForm
            roomId={roomFromServer.id}
            onAgentInvited={refreshFromServer}
            existingMemberHandles={roomFromServer.members.map((m) => m.handle)}
          />
        </div>
      </details>
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('focus')}
    <CollapsibleSection
      id="focus"
      title="Focus mode"
      count={focusedMembers.length}
      pinRoomId={roomFromServer.id}
    >
      <div class="focus-panel">
        {#if focusedMembers.length > 0}
          <ul class="focus-list" aria-label="Focused members">
            {#each focusedMembers as entry (entry.memberHandle)}
              <li class="focus-entry">
                <div>
                  <strong>{labelForMember(entry.memberHandle)}</strong>
                  <span>{formatFocusWindow(entry)}</span>
                  {#if entry.reason}<p>{entry.reason}</p>{/if}
                </div>
                <button
                  type="button"
                  class="focus-secondary"
                  disabled={exitingFocusHandle === entry.memberHandle}
                  onclick={() => void exitFocus(entry.memberHandle)}
                >{exitingFocusHandle === entry.memberHandle ? 'Pulling…' : 'Pull out'}</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="focus-empty">No one is heads-down in this room.</p>
        {/if}

        <button type="button" class="focus-primary" onclick={() => (showFocusModal = true)}>
          Set agent focus
        </button>
      </div>
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('asks')}
    <CollapsibleSection
      id="asks"
      title="Open asks"
      count={asksFromServer.filter((a) => a.status === 'open').length}
      pinRoomId={roomFromServer.id}
    >
      <InteractiveAsksPanel
        {asksFromServer}
        {asksFetchFailed}
        roomNameLabel={roomFromServer.name}
      />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('plans')}
    <CollapsibleSection
      id="plans"
      title="Plans"
      count={plansForRoom.length}
      pinRoomId={roomFromServer.id}
    >
      <RoomPlansPanel plans={plansForRoom} roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('tasks')}
    <CollapsibleSection
      id='tasks'
      title='Tasks'
      count={tasksForRoom.length}
      pinRoomId={roomFromServer.id}
    >
      <RoomTasksPanel tasks={tasksForRoom} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('linked-rooms')}
    <CollapsibleSection id="linked-rooms" title="Linked rooms" pinRoomId={roomFromServer.id}>
      <RoomLinksPanel roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('interviews')}
    <CollapsibleSection id="interviews" title="Interviews" pinRoomId={roomFromServer.id}>
      <InterviewsRoomPanel
        roomId={roomFromServer.id}
        members={roomFromServer.members}
        asHandle={callerHandle}
      />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('artefacts')}
    <CollapsibleSection id="artefacts" title="Artefacts" pinRoomId={roomFromServer.id}>
      <ArtefactsRoomPanel roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('screenshots')}
    <CollapsibleSection id="screenshots" title="Screenshots" pinRoomId={roomFromServer.id}>
      <ScreenshotsRoomPanel roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('memory')}
    <CollapsibleSection id="memory" title="Room memory" pinRoomId={roomFromServer.id}>
      <RoomMemoryLauncher roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}

    {#if !pinnedSectionIds.has('attachments')}
    <CollapsibleSection id="attachments" title="Attachments" count={sharedFilesFromServer.length} pinRoomId={roomFromServer.id}>
      <AttachmentsTray roomId={roomFromServer.id} sharedFiles={sharedFilesFromServer} />
      <UploadFileButton roomId={roomFromServer.id} />
    </CollapsibleSection>
    {/if}
    <div class="room-menu-actions" aria-label="Room utilities">
      <button type="button" class="room-menu-action" onclick={() => showBreakModal = true}>

        Context break
      </button>
      <button type="button" class="room-menu-action" onclick={() => (showDigestPanel = true)}>
        <span aria-hidden="true">📊</span>
        Digest
      </button>
      <a class="room-menu-action" href={`/search?roomId=${roomFromServer.id}`}>
        <span aria-hidden="true">⌕</span>
        Search this room
      </a>
    </div>
      </RoomMenuDropdown>
    {/snippet}
  </RoomNameHeader>

  {#if focusedMembers.length > 0}
    <section class="focus-strip" aria-label="Active focus mode">
      <span class="focus-dot" aria-hidden="true"></span>
      <strong>{focusedMembers.length === 1 ? 'Focus mode' : 'Focus modes'}</strong>
      <span>{focusedMembers.map((entry) => labelForMember(entry.memberHandle)).join(', ')}</span>
    </section>
  {/if}

  {#if showFocusModal}
    <FocusModeModal
      roomId={roomFromServer.id}
      members={focusableMembers.length > 0 ? focusableMembers : roomFromServer.members}
      onClose={() => showFocusModal = false}
      onEntered={() => { showFocusModal = false; invalidateAll(); }}
    />
  {/if}

  {#if showDigestPanel}
    <RoomDigestPanel roomId={roomFromServer.id} onClose={() => (showDigestPanel = false)} />
  {/if}

  <MessageList
    messages={liveMessageRoomId === null ? messagesFromServer : liveMessages}
    members={roomFromServer.members}
    roomId={roomFromServer.id}
    asHandle={callerHandle}
    onReplyRequested={setReplyingTo}
    {hasOlderMessages}
    isLoadingOlder={loadingOlderMessages}
    onLoadOlder={loadOlderMessages}
    readReceiptEvent={latestRealtimeEvent}
  />
  <div class="composer-dock">
    <ChatComposer
      roomId={roomFromServer.id}
      asHandle={callerHandle}
      membersInRoom={roomFromServer.members}
      {aliasesInRoom}
      onMessagePosted={mergePostedMessageAndClearReply}
      replyingToMessageId={replyingToMessageId ?? undefined}
      onClearReplyingTo={clearReplyingTo}
      {lastOwnEditableMessage}
    />
    <AgentStatusFooter roomId={roomFromServer.id} />
  </div>

  {#if agentEventsFromServer.length > 0}
    <AgentTimeline events={agentEventsFromServer} />
  {/if}
    </div>

    <aside class="room-context-rail" class:collapsed={rightPaneCollapsed} aria-label="Pinned room context">
      <button
        type="button"
        class="pane-toggle pane-toggle-right"
        aria-label={rightPaneCollapsed ? 'Expand right pane (press ])' : 'Collapse right pane (press ])'}
        aria-expanded={!rightPaneCollapsed}
        title={rightPaneCollapsed ? 'Expand · ]' : 'Collapse · ]'}
        onclick={toggleRightPane}
      >
        <svg viewBox="0 0 12 24" aria-hidden="true">
          {#if rightPaneCollapsed}
            <path d="M9 4 L3 12 L9 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <path d="M3 4 L9 12 L3 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {/if}
        </svg>
      </button>
      {#if rightPaneCollapsed}<div class="rail-collapsed-spacer" aria-hidden="true"></div>{:else}
      <h2 class="rail-heading">Pinned</h2>
      {#if pinnedSectionIds.size === 0}
        <p class="rail-empty">
          Pin a section from the <strong>More ▾</strong> menu (📌 button in each section header)
          to keep it here as an expand/contract card.
        </p>
      {:else}
        <!-- JWPK msg_8j3yzijma0: pinned sections in the rail render as
             their own expand/contract collapsible cards (NOT jump-to-
             dropdown, NOT always-expanded inline). Each card is the
             SAME CollapsibleSection component as the dropdown counterpart
             — collapsed by default, lazy-mounts its panel on first
             expand. Mutual exclusion: each section renders EITHER in
             dropdown (when !pinned) OR here (when pinned), never both.
             Single mount per section regardless of pinned-state, no
             double-fetch. -->
        {#if pinnedSectionIds.has('participants')}
          <CollapsibleSection id="participants" title="Participants" count={roomFromServer.members.length} pinRoomId={roomFromServer.id}>
            <ParticipantsPanel
              roomId={roomFromServer.id}
              members={roomFromServer.members}
              {aliasesInRoom}
              {focusedMembers}
              onMemberPicked={openMemberSheet}
              onInviteRequested={focusInviteForm}
            />
            <details id="inviteAgentSection" class="nested-invite-toggle">
              <summary class="nested-invite-summary">
                <span class="nested-invite-label">Invite an agent</span>
                <span class="nested-invite-chevron" aria-hidden="true">▾</span>
              </summary>
              <div class="nested-invite-body">
                <InviteAgentForm
                  roomId={roomFromServer.id}
                  onAgentInvited={refreshFromServer}
                  existingMemberHandles={roomFromServer.members.map((m) => m.handle)}
                />
              </div>
            </details>
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('focus')}
          <CollapsibleSection id="focus" title="Focus mode" count={focusedMembers.length} pinRoomId={roomFromServer.id}>
            <div class="focus-panel">
              {#if focusedMembers.length > 0}
                <ul class="focus-list" aria-label="Focused members">
                  {#each focusedMembers as entry (entry.memberHandle)}
                    <li class="focus-entry">
                      <div>
                        <strong>{labelForMember(entry.memberHandle)}</strong>
                        <span>{formatFocusWindow(entry)}</span>
                        {#if entry.reason}<p>{entry.reason}</p>{/if}
                      </div>
                      <button
                        type="button"
                        class="focus-secondary"
                        disabled={exitingFocusHandle === entry.memberHandle}
                        onclick={() => void exitFocus(entry.memberHandle)}
                      >{exitingFocusHandle === entry.memberHandle ? 'Pulling…' : 'Pull out'}</button>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="focus-empty">No one is heads-down in this room.</p>
              {/if}
              <button type="button" class="focus-primary" onclick={() => (showFocusModal = true)}>
                Set agent focus
              </button>
            </div>
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('asks')}
          <CollapsibleSection id="asks" title="Open asks" count={asksFromServer.filter((a) => a.status === 'open').length} pinRoomId={roomFromServer.id}>
            <InteractiveAsksPanel
              {asksFromServer}
              {asksFetchFailed}
              roomNameLabel={roomFromServer.name}
            />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('plans')}
          <CollapsibleSection id="plans" title="Plans" count={plansForRoom.length} pinRoomId={roomFromServer.id}>
            <RoomPlansPanel plans={plansForRoom} roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('tasks')}
          <CollapsibleSection id="tasks" title="Tasks" count={tasksForRoom.length} pinRoomId={roomFromServer.id}>
            <RoomTasksPanel tasks={tasksForRoom} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('linked-rooms')}
          <CollapsibleSection id="linked-rooms" title="Linked rooms" pinRoomId={roomFromServer.id}>
            <RoomLinksPanel roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('interviews')}
          <CollapsibleSection id="interviews" title="Interviews" pinRoomId={roomFromServer.id}>
            <InterviewsRoomPanel
              roomId={roomFromServer.id}
              members={roomFromServer.members}
              asHandle={callerHandle}
            />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('artefacts')}
          <CollapsibleSection id="artefacts" title="Artefacts" pinRoomId={roomFromServer.id}>
            <ArtefactsRoomPanel roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('screenshots')}
          <CollapsibleSection id="screenshots" title="Screenshots" pinRoomId={roomFromServer.id}>
            <ScreenshotsRoomPanel roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('memory')}
          <CollapsibleSection id="memory" title="Room memory" pinRoomId={roomFromServer.id}>
            <RoomMemoryLauncher roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
        {#if pinnedSectionIds.has('attachments')}
          <CollapsibleSection id="attachments" title="Attachments" count={sharedFilesFromServer.length} pinRoomId={roomFromServer.id}>
            <AttachmentsTray roomId={roomFromServer.id} sharedFiles={sharedFilesFromServer} />
            <UploadFileButton roomId={roomFromServer.id} />
          </CollapsibleSection>
        {/if}
      {/if}
      {/if}
    </aside>
  </div>
</SimplePageShell>

<RemoveMemberFlow
  roomId={roomFromServer.id}
  {memberPendingRemoval}
  onRemoved={handleMemberRemoved}
  onCancelled={() => (memberPendingRemoval = null)}
/>

{#if detailSheetMember}
  {@const memberForSheet = detailSheetMember}

  {#snippet changeHandleBody()}
    <ChangeHandleForm
      roomId={roomFromServer.id}
      globalHandle={memberForSheet.handle}
      currentAlias={findAliasForMember(memberForSheet.handle)}
      onAliasApplied={handleAliasApplied}
      onCancel={handleChangeHandleCancel}
    />
  {/snippet}

  {#snippet presentationBody()}
    <ParticipantPresentationForm
      roomId={roomFromServer.id}
      member={memberForSheet}
      onSaved={handlePresentationSaved}
      onCancel={handleChangeHandleCancel}
    />
  {/snippet}

  <ParticipantDetailSheet
    member={memberForSheet}
    aliasInRoom={findAliasForMember(memberForSheet.handle)}
    onAction={handleSheetAction}
    onClose={closeMemberSheet}
    alternateBody={detailSheetMode === 'changeHandle'
      ? changeHandleBody
      : detailSheetMode === 'presentation'
        ? presentationBody
        : undefined}
  />
{/if}

<style>
  /* Width fix step 2b + 3 (JWPK msg_r2qkxstx6k): three-column grid that
     flanks the chat content with a starred-rooms quick-nav on the left
     and a pinned-context quicklink rail on the right. The shell width
     cap (1680px, commit 28ff94f) is the canvas.

     Below 1240px the rails' own CSS hides them and the grid collapses
     to a single column — keeps the existing mobile/medium UX byte-
     identical. */
  .room-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.2rem;
    align-items: start;
    transition: grid-template-columns 180ms ease;
  }
  @media (min-width: 1240px) {
    .room-grid {
      grid-template-columns: 16rem minmax(0, 1fr) 17rem;
    }
    .room-grid.left-collapsed {
      grid-template-columns: 1.75rem minmax(0, 1fr) 17rem;
    }
    .room-grid.right-collapsed {
      grid-template-columns: 16rem minmax(0, 1fr) 1.75rem;
    }
    .room-grid.left-collapsed.right-collapsed {
      grid-template-columns: 1.75rem minmax(0, 1fr) 1.75rem;
    }
  }
  /* Left pane wraps RoomQuickNav + its toggle button. Toggle is always
     visible (even when collapsed — the only way to expand back). */
  .left-pane {
    position: sticky;
    top: 4.5rem;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  @media (max-width: 1239px) {
    /* Below the 3-col breakpoint the panes stack — hide collapse UX. */
    .pane-toggle { display: none; }
  }
  .pane-toggle {
    align-self: flex-end;
    width: 1.4rem;
    height: 2.2rem;
    padding: 0;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    color: var(--ink-soft);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms ease, color 120ms ease;
  }
  .pane-toggle:hover {
    background: color-mix(in srgb, var(--accent, #6b21a8) 8%, var(--surface-card));
    color: var(--ink-strong);
  }
  .pane-toggle svg {
    width: 0.7rem;
    height: 1.2rem;
    display: block;
  }
  .pane-toggle-right {
    /* The right rail's toggle sits at the top-left edge so it remains
       hand-reachable when the rail is collapsed to a thin strip. */
    position: absolute;
    top: 0.55rem;
    left: -0.7rem;
    z-index: 1;
  }
  .room-context-rail.collapsed {
    padding: 0.55rem 0.2rem;
    overflow: hidden;
  }
  .rail-collapsed-spacer {
    /* keeps the collapsed rail height balanced with the chat column */
    min-height: 6rem;
  }
  .room-main {
    /* min-width: 0 lets the chat column shrink properly inside the grid
       column. Without it, wide markdown tables or pre blocks would push
       the column wider than the grid track and break the layout. */
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Right rail — pinned-section quicklinks. Phase A: jump-to-section
     buttons that open the corresponding CollapsibleSection inside the
     More dropdown + scroll into view. Phase B will promote the SECTION
     CONTENT inline here via the snippet pattern (msg_woy8tl2km1). */
  .room-context-rail {
    position: sticky;
    top: 4.5rem;
    align-self: start;
    max-height: calc(100vh - 6rem);
    overflow-y: auto;
    padding: 0.85rem 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.95rem;
    background: var(--surface-card);
    display: none;
  }
  @media (min-width: 1240px) {
    .room-context-rail { display: block; }
  }
  .rail-heading {
    margin: 0 0 0.6rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .rail-empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .rail-empty strong {
    color: var(--ink-strong);
    font-weight: 700;
  }
  /* Phase A's .rail-list/.rail-jump/.rail-jump-pin/.rail-jump-title CSS
     removed — the rail now renders CollapsibleSection cards directly
     instead of jump-to-section buttons (JWPK msg_8j3yzijma0). The
     CollapsibleSection's own styling carries the card look; the rail
     just stacks them vertically inside the sticky aside. */

  /* Task #67: dock the composer to the bottom of the visual viewport on
     mobile so the iOS keyboard doesn't leave a dead zone above it.
     interactive-widget=resizes-content (app.html) shrinks the layout
     viewport when the keyboard opens; position:sticky bottom:0 then keeps
     the composer flush against the new viewport bottom. safe-area-inset
     handles the iPhone home-indicator strip. */
  .composer-dock {
    position: sticky;
    bottom: 0;
    z-index: 20;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background: linear-gradient(to bottom, transparent 0, var(--bg) 0.6rem, var(--bg) 100%);
  }

  /* JWPK msg_5lfbp31u6t: invite form inside Participants is a collapsed
     <details> by default (was always-open). Click 'Invite an agent ▾' to
     expand. Same in both the dropdown render and the rail-card render. */
  .nested-invite-toggle {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line-soft);
  }
  .nested-invite-summary {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    list-style: none;
    color: var(--ink-strong);
    font-weight: 800;
    font-size: 0.92rem;
  }
  .nested-invite-summary::-webkit-details-marker { display: none; }
  .nested-invite-label { flex: 1; }
  .nested-invite-chevron {
    color: var(--ink-soft);
    transition: transform 180ms ease;
  }
  .nested-invite-toggle[open] .nested-invite-chevron {
    transform: rotate(180deg);
  }
  .nested-invite-body { margin-top: 0.6rem; }
  .room-menu-actions {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line-soft);
  }
  .discipline-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .discipline-link {
    display: inline-flex;
    align-items: center;
    min-height: 2rem;
    padding: 0.42rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line-soft));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised));
    color: var(--ink-strong);
    font-size: 0.84rem;
    font-weight: 850;
    text-decoration: none;
  }
  .discipline-link:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .room-menu-action {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.86rem;
    font-weight: 800;
    text-decoration: none;
  }
  .room-menu-action:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .focus-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .focus-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .focus-entry {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line-soft));
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-card));
  }
  .focus-entry strong {
    display: block;
    color: var(--ink-strong);
    font-size: 0.9rem;
  }
  .focus-entry span,
  .focus-empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .focus-entry p {
    margin: 0.25rem 0 0;
    color: var(--ink-strong);
    font-size: 0.85rem;
  }
  .focus-primary,
  .focus-secondary {
    border-radius: 999px;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .focus-primary {
    align-self: flex-start;
    padding: 0.48rem 0.8rem;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
  }
  .focus-secondary {
    padding: 0.34rem 0.7rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .focus-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .focus-strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.6rem 0 0.7rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line-soft));
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-card));
    color: var(--ink-strong);
    font-size: 0.86rem;
  }
  .focus-strip span:last-of-type {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .focus-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--accent) 15%, transparent);
    flex: 0 0 auto;
  }
</style>
