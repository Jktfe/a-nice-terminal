<!--
  Room view route — chat is the body, context lives in a single
  RoomMenuDropdown above (D1.6-T1b reshape per JWPK D2.7).

  Heavy sub-trees (the More-dropdown sections, the pinned right-rail,
  and the participant-detail sheet orchestration) live in dedicated
  RoomDetail* sub-components so this route stays under the 600-line
  component cap. The discipline-links nav stays inline here because
  page.test.ts asserts the literal markup in this file.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount, untrack } from 'svelte';
  import {
    subscribeToRoomEvents,
    subscribeRoomConnectionState,
    type RealtimeRoomHandle,
    type RealtimeRoomStore
  } from '$lib/stores/realtimeRoom.svelte';
  import RealtimeStatusIndicator from '$lib/components/RealtimeStatusIndicator.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import ChatComposer from '$lib/components/ChatComposer.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import AntCrawlerOverlay from '$lib/components/AntCrawlerOverlay.svelte';
  import AliasAppliedBanner from '$lib/components/AliasAppliedBanner.svelte';
  import AgentTimeline from '$lib/components/AgentTimeline.svelte';
  import AgentStatusFooter from '$lib/components/AgentStatusFooter.svelte';
  import RoomMenuDropdown from '$lib/components/RoomMenuDropdown.svelte';
  import RoomNameHeader from '$lib/components/RoomNameHeader.svelte';
  import FocusModeModal from '$lib/components/FocusModeModal.svelte';
  import BreakConfirmModal from '$lib/components/BreakConfirmModal.svelte';
  import RoomDetailFocusStrip from '$lib/components/RoomDetailFocusStrip.svelte';
  import RoomDetailLeftPane from '$lib/components/RoomDetailLeftPane.svelte';
  import { roomSidePanelPins } from '$lib/stores/roomSidePanelPins.svelte';
  import RoomDigestPanel from '$lib/components/RoomDigestPanel.svelte';
  import RoomCardActivity from '$lib/components/RoomCardActivity.svelte';
  import RoomDetailContextRail from '$lib/components/RoomDetailContextRail.svelte';
  import RoomDetailMemberSheet from '$lib/components/RoomDetailMemberSheet.svelte';
  import RoomDetailMoreMenu from '$lib/components/RoomDetailMoreMenu.svelte';
  import AwayModeToggle from '$lib/components/AwayModeToggle.svelte';
  import RoomModeSwitcher from '$lib/components/RoomModeSwitcher.svelte';
  import InlineReplyComposer from '$lib/components/InlineReplyComposer.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import {
    LEFT_PANE_KEY,
    RIGHT_PANE_KEY,
    focusInviteForm,
    isTypingTarget,
    makeLabelForMember,
    readPaneCollapsedFlag,
    writePaneCollapsedFlag
  } from '$lib/components/roomDetailHelpers';
  import { mergeQuietMessageFeed } from '$lib/chat/quietMessageFeed';
  import {
    ensureBrowserSessionForRoom,
    type EnsureBrowserSessionResult
  } from '$lib/browserSessionClient';
  import type { ChatRoom, RoomMember } from '$lib/server/chatRoomStore';
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { AgentEvent } from '$lib/server/agentTimelineStore';
  import type { SharedFile } from '$lib/server/chatAttachmentStore';
  import type { Ask } from '$lib/server/askStore';
  import type { TaskForRoom } from '$lib/server/taskStore';
  import type { FocusEntry } from '$lib/server/focusModeStore';
  import type { RoomMode } from '$lib/server/roomModesStore';
  import type { AwayTier } from '$lib/server/awayModeStore';

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
    roomMode?: RoomMode;
    allRoomLabels?: Record<string, string>;
    bringInAppAvailable?: boolean;
    responders?: {
      id: number;
      terminal_id: string;
      order_index: number;
      handle: string;
      pane_status: 'unknown' | 'verified' | 'stale';
    }[];
  };
  type Props = { data: RoomPageData };

  let { data }: Props = $props();

  // Messages keep a quiet client merge layer so posts do not replace the list.
  const roomFromServer = $derived<ChatRoom>(data.room);
  // Opt-in ant crawler overlay (real-element terrain): /rooms/<id>?crawler=1.
  let showCrawler = $state(false);
  onMount(() => {
    showCrawler = new URLSearchParams(window.location.search).get('crawler') === '1';
  });
  const messagesFromServer = $derived<ChatMessage[]>(data.messages);
  const aliasesInRoom = $derived<RoomAliasEntry[]>(data.aliases);
  const agentEventsFromServer = $derived<AgentEvent[]>(data.agentEvents ?? []);
  // #76 — find the caller's most recent editable message in this room
  // so ↑ in an empty composer loads it. Walk from the newest backwards,
  // skip system kinds + deleted rows. Fall back to @JWPK so the browser
  // never reintroduces the legacy @you sentinel when capabilities fail.
  const callerHandle = $derived(
    (data as { asHandle?: string }).asHandle ?? '@JWPK'
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
  const roomMode = $derived<RoomMode>(data.roomMode ?? 'brainstorm');
  const primaryRoomPlanHref = $derived(
    plansForRoom[0]?.planId
      ? `/plans/${encodeURIComponent(plansForRoom[0].planId)}`
      : '/plans'
  );
  const focusedMembers = $derived<FocusEntry[]>(data.focusedMembers ?? []);
  const bringInAppAvailable = $derived<boolean>(data.bringInAppAvailable ?? false);
  const responders = $derived(data.responders ?? []);
  const focusableMembers = $derived(
    roomFromServer.members.filter((member) => member.kind === 'agent')
  );

  // Collapsible L/R panes (JWPK msg_1rmpt6ozub + msg_xyrlvisazp,
  // 2026-05-19). Per-device localStorage so the operator's preference
  // sticks across rooms + reloads. Keyboard shortcuts: '[' toggles left,
  // ']' toggles right (when not in an input/textarea so typing isn't
  // hijacked). aria-expanded on the toggle buttons drives screen readers.
  let leftPaneCollapsed = $state(false);
  let rightPaneCollapsed = $state(false);

  function toggleLeftPane(): void {
    leftPaneCollapsed = !leftPaneCollapsed;
    writePaneCollapsedFlag(LEFT_PANE_KEY, leftPaneCollapsed);
  }
  function toggleRightPane(): void {
    rightPaneCollapsed = !rightPaneCollapsed;
    writePaneCollapsedFlag(RIGHT_PANE_KEY, rightPaneCollapsed);
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
  let browserSessionReadyKey = $state('');
  let browserSessionError = $state('');
  let browserSessionRetrying = $state(false);
  function rememberBrowserSessionResult(
    key: string,
    authorHandle: string,
    result: EnsureBrowserSessionResult
  ): void {
    if (lastBrowserSessionRebindKey !== key) return;
    if (result.ok) {
      browserSessionReadyKey = key;
      browserSessionError = '';
      return;
    }
    if (result.reason === 'no-handle') return;
    browserSessionReadyKey = '';
    const statusHint = typeof result.status === 'number' ? ` (${result.status})` : '';
    browserSessionError = `Could not establish session for ${authorHandle} in this room${statusHint}: ${result.reason}`;
  }
  $effect(() => {
    const roomId = roomFromServer.id;
    const authorHandle = callerHandle.trim();
    if (roomId.length === 0 || authorHandle.length === 0) return;
    const key = `${roomId}:${authorHandle}`;
    if (key === lastBrowserSessionRebindKey) return;
    lastBrowserSessionRebindKey = key;
    browserSessionReadyKey = '';
    browserSessionError = '';
    // Per-room browser_session rebind. The cookie is site-scoped so the
    // /api/realtime/<roomId>/events EventSource can authenticate too; the
    // server-side read/write gates still enforce room access per request.
    // This must be keyed on room id, not only onMount: SvelteKit can reuse
    // this route component across client-side room navigation.
    void ensureBrowserSessionForRoom({ roomId, authorHandle, force: true }).then((result) => {
      rememberBrowserSessionResult(key, authorHandle, result);
    });
  });

  // Away-tier fetch — codex CHANGES REQUESTED 2026-05-24 (orsz2321qb):
  // tier is server-side per-user state (table away_modes, keyed by handle)
  // so agents can OBSERVE the tier and shift behaviour. The endpoint reads
  // the demo-login Path=/ cookie via resolveBrowserSessionSecretIgnoringRoom
  // and gates: cookie-handle MUST equal :handle URL param. On 401 we keep
  // the optimistic 'active' default and the room-mode fallback in the
  // toggle handles the visual state until the user picks a tier.
  let currentAwayTier = $state<AwayTier>('active');
  let awayTierFetchError = $state('');
  let lastAwayTierFetchKey = $state('');
  $effect(() => {
    const handle = callerHandle.trim();
    if (handle.length === 0) return;
    if (handle === lastAwayTierFetchKey) return;
    lastAwayTierFetchKey = handle;
    void (async () => {
      try {
        const res = await fetch(`/api/away-modes/${encodeURIComponent(handle)}`);
        if (!res.ok) {
          awayTierFetchError = `Away mode could not load (HTTP ${res.status}).`;
          return;
        }
        const body = await res.json();
        const tier = body?.mode?.tier as AwayTier | undefined;
        if (tier === 'active' || tier === 'away-desk' || tier === 'away-office' || tier === 'away-phone') {
          currentAwayTier = tier;
          awayTierFetchError = '';
        }
      } catch {
        awayTierFetchError = 'Away mode could not load (network).';
      }
    })();
  });

  onMount(() => {
    leftPaneCollapsed = readPaneCollapsedFlag(LEFT_PANE_KEY);
    rightPaneCollapsed = readPaneCollapsedFlag(RIGHT_PANE_KEY);
    window.addEventListener('keydown', handlePaneShortcut);

    return () => window.removeEventListener('keydown', handlePaneShortcut);
  });

  // Per-room pin hydrate — must run on EVERY roomId change, not just
  // initial onMount. SvelteKit reuses this component across client-side
  // room navigation (/rooms/A → /rooms/B), so a single onMount init was
  // leaving the new room's pin set empty → pinned sections disappeared.
  // JWPK msg_yymzxywxwy: 'the pinned Right hand panel details disappear
  // WAY too frequently'. Banked pattern from the browserSessionRebind
  // effect above — same shape, different store.
  let lastPinHydrateKey = $state<string | null>(null);
  $effect(() => {
    const key = roomFromServer.id;
    if (!key || key === lastPinHydrateKey) return;
    lastPinHydrateKey = key;
    roomSidePanelPins.init(key);
  });
  const pinnedSectionIds = $derived(roomSidePanelPins.getPinsForRoom(roomFromServer.id));

  let detailSheetMember = $state<RoomMember | null>(null);
  let appliedBanner = $state<{ globalHandle: string; alias: string } | null>(null);
  let showFocusModal = $state(false);
  let focusModalTarget = $state<string | null>(null);
  let breakReason = $state('');
  let showBreakModal = $state(false);
  let showDigestPanel = $state(false);
  // M30 slice 3b: reply target from MessageRow Reply button.
  let replyingToMessageId = $state<string | null>(null);
  let inlineReplyTarget = $state<ChatMessage | null>(null);
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

  function remintBrowserSessionForCurrentRoom() {
    const roomId = currentRoomId;
    const authorHandle = callerHandle.trim();
    const key = `${roomId}:${authorHandle}`;
    if (roomId.length === 0 || authorHandle.length === 0) return;
    lastBrowserSessionRebindKey = key;
    browserSessionReadyKey = '';
    browserSessionError = '';
    browserSessionRetrying = true;
    void ensureBrowserSessionForRoom({ roomId, authorHandle, force: true })
      .then((result) => {
        rememberBrowserSessionResult(key, authorHandle, result);
      })
      .finally(() => {
        if (lastBrowserSessionRebindKey === key) browserSessionRetrying = false;
      });
  }

  // GAP-55 T2-A SSE subscription (realtime-layer-design-contract 2026-05-14).
  // KEYED on the primitive room id (not the room object) so invalidateAll's
  // new data.room reference does NOT re-fire this effect. Cleanup ONLY
  // closes the handle — no realtime-state read/write inside cleanup so the
  // effect cannot self-retrigger. Effect-update-depth bug fix 2026-05-14.
  const currentRoomId = $derived(roomFromServer.id);
  let realtime = $state<RealtimeRoomHandle | null>(null);
  let lastEventCount = $state(0);
  // Slice 4 follow-up consolidation 2026-05-24: connection-state surface
  // for the RealtimeStatusIndicator pill in the room header. Shares the
  // same pooled EventSource as `subscribeToRoomEvents` above.
  let realtimeStatus = $state<RealtimeRoomStore | null>(null);
  const latestRealtimeEvent = $derived(realtime?.lastEvent ?? null);
  $effect(() => {
    if (browserSessionReadyKey !== `${currentRoomId}:${callerHandle.trim()}`) return;
    // PATCH A: skip invalidateAll on the INITIAL onopen — data was already
    // fetched server-side and is on the page. Only invalidate on actual
    // reconnects (subsequent opens), where the client needs to catch up
    // on anything missed during the gap.
    let seenInitialOpen = false;
    const handle = subscribeToRoomEvents(currentRoomId, {
      onConnect: () => {
        if (!seenInitialOpen) { seenInitialOpen = true; return; }
        void invalidateAll();
      },
      onDisconnect: remintBrowserSessionForCurrentRoom
    });
    realtime = handle;
    lastEventCount = 0;
    const statusHandle = subscribeRoomConnectionState(currentRoomId);
    realtimeStatus = statusHandle;
    return () => {
      handle.close();
      statusHandle.close();
    };
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
    inlineReplyTarget = null;
  }
  function clearReplyingTo() { replyingToMessageId = null; }
  function setInlineReplyTarget(message: ChatMessage) {
    inlineReplyTarget = message;
    clearReplyingTo();
  }
  function clearInlineReplyTarget() { inlineReplyTarget = null; }
  function mergePostedMessageAndClearReply(message?: ChatMessage) {
    clearReplyingTo();
    clearInlineReplyTarget();
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
  }

  function closeMemberSheet() {
    detailSheetMember = null;
  }

  function handleAliasApplied(savedAlias: string, member: RoomMember) {
    appliedBanner = { globalHandle: member.handle, alias: savedAlias };
    closeMemberSheet();
    refreshFromServer();
  }

  function handleSetFocusFromSheet(memberHandle: string) {
    focusModalTarget = memberHandle;
    showFocusModal = true;
  }

  function dismissBanner() {
    appliedBanner = null;
  }

  const labelForMember = $derived(makeLabelForMember(roomFromServer));
</script>

<svelte:head>
  <title>{roomFromServer.name} | ANT vNext</title>
</svelte:head>

<SimplePageShell showIntro={false}>
  <div class="room-grid" class:left-collapsed={leftPaneCollapsed} class:right-collapsed={rightPaneCollapsed}>
    <RoomDetailLeftPane
      roomId={roomFromServer.id}
      roomLabels={data.allRoomLabels ?? {}}
      {leftPaneCollapsed}
      onToggleLeftPane={toggleLeftPane}
    />
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
       real-estate. Invite agent is NESTED inside Participants per JWPK D2.7.
       Discipline-links nav remains inline (page.test.ts asserts this markup);
       everything else lives in RoomDetailMoreMenu. -->

  <RoomNameHeader
    roomId={roomFromServer.id}
    roomName={roomFromServer.name}
    startedBy={roomFromServer.whoCreatedIt}
    lastUpdate={roomFromServer.lastUpdate}
    contractId={roomFromServer.contractId}
    description={roomFromServer.description}
    bringInAppAvailable={bringInAppAvailable}
  >
    {#snippet status()}
      {#if realtimeStatus}
        <RealtimeStatusIndicator store={realtimeStatus} onManualRetry={remintBrowserSessionForCurrentRoom} />
      {/if}
      <RoomCardActivity roomId={roomFromServer.id} variant="header" />
    {/snippet}
    {#snippet menu()}
      <RoomMenuDropdown summary="More" innerIds={['participants', 'responders', 'focus', 'asks', 'plans', 'tasks', 'votes', 'linked-rooms', 'interviews', 'artefacts', 'screenshots', 'memory', 'attachments']}>
    <nav class="discipline-links" aria-label="Room work surfaces">
      <a class="discipline-link" href={`/asks?roomId=${roomFromServer.id}`}>Asks</a>
      <a class="discipline-link" href={primaryRoomPlanHref}>Plan</a>
      <Explainable explainKey="tasks-section"><a class="discipline-link" href="#tasks">Tasks</a></Explainable>
    </nav>
    <RoomDetailMoreMenu
      room={roomFromServer}
      {aliasesInRoom}
      {focusedMembers}
      {asksFromServer}
      {asksFetchFailed}
      {plansForRoom}
      {tasksForRoom}
      {sharedFilesFromServer}
      {callerHandle}
      {pinnedSectionIds}
      {labelForMember}
      {responders}
      onMemberPicked={openMemberSheet}
      onInviteRequested={focusInviteForm}
      onAgentInvited={refreshFromServer}
      onOpenFocusModal={() => (showFocusModal = true)}
      onOpenBreakModal={() => (showBreakModal = true)}
      onOpenDigestPanel={() => (showDigestPanel = true)}
    />
      </RoomMenuDropdown>
    {/snippet}
  </RoomNameHeader>

  {#if browserSessionError}
    <div class="session-alert" role="alert">
      <span>{browserSessionError}</span>
      <button type="button" onclick={remintBrowserSessionForCurrentRoom} disabled={browserSessionRetrying}>
        {browserSessionRetrying ? 'Retrying session...' : 'Retry session'}
      </button>
    </div>
  {/if}

  <Explainable explainKey="room-mode">
    <RoomModeSwitcher
      roomId={roomFromServer.id}
      mode={roomMode}
      onModeChange={() => invalidateAll()}
    />
  </Explainable>

  <Explainable explainKey="room-away">
  <AwayModeToggle
    roomId={roomFromServer.id}
    currentMode={roomMode}
    currentTier={currentAwayTier}
    callerHandle={callerHandle}
    loadError={awayTierFetchError}
    onModeChange={(m) => invalidateAll()}
    onTierChange={(t) => (currentAwayTier = t)}
  />
  </Explainable>

  <RoomDetailFocusStrip {focusedMembers} {labelForMember} />

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
    {roomMode}
    asHandle={callerHandle}
    onReplyRequested={setReplyingTo}
    onInlineReplyRequested={setInlineReplyTarget}
    {hasOlderMessages}
    isLoadingOlder={loadingOlderMessages}
    onLoadOlder={loadOlderMessages}
    readReceiptEvent={latestRealtimeEvent}
  />
  {#if inlineReplyTarget}
    <InlineReplyComposer
      roomId={roomFromServer.id}
      asHandle={callerHandle}
      targetMessage={inlineReplyTarget}
      membersInRoom={roomFromServer.members}
      onMessagePosted={mergePostedMessageAndClearReply}
      onCancel={clearInlineReplyTarget}
    />
  {/if}
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
      {#if showCrawler}
        <AntCrawlerOverlay roomId={roomFromServer.id} />
      {/if}
    </div>

    <RoomDetailContextRail
      room={roomFromServer}
      {aliasesInRoom}
      {focusedMembers}
      {asksFromServer}
      {asksFetchFailed}
      {plansForRoom}
      {tasksForRoom}
      {sharedFilesFromServer}
      {callerHandle}
      {pinnedSectionIds}
      {rightPaneCollapsed}
      {labelForMember}
      {responders}
      onMemberPicked={openMemberSheet}
      onInviteRequested={focusInviteForm}
      onAgentInvited={refreshFromServer}
      onOpenFocusModal={() => (showFocusModal = true)}
      onToggleRightPane={toggleRightPane}
    />
  </div>
</SimplePageShell>

<RoomDetailMemberSheet
  roomId={roomFromServer.id}
  member={detailSheetMember}
  {aliasesInRoom}
  onClose={closeMemberSheet}
  onAliasApplied={handleAliasApplied}
  onMemberRemoved={refreshFromServer}
  onPresentationSaved={refreshFromServer}
  onSetFocus={handleSetFocusFromSheet}
/>

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
  .room-main {
    /* min-width: 0 lets the chat column shrink properly inside the grid
       column. Without it, wide markdown tables or pre blocks would push
       the column wider than the grid track and break the layout. */
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative; /* anchor for the opt-in ant crawler overlay */
  }

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

  .session-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0.65rem 0;
    padding: 0.7rem 0.85rem;
    border: 1px solid color-mix(in srgb, #dc2626 45%, var(--line-soft));
    border-radius: 0.55rem;
    background: color-mix(in srgb, #dc2626 8%, var(--surface-raised));
    color: var(--ink-strong);
    font-size: 0.86rem;
    font-weight: 700;
  }
  .session-alert button {
    flex: 0 0 auto;
    min-height: 2rem;
    border: 1px solid color-mix(in srgb, #dc2626 54%, var(--line-soft));
    border-radius: 999px;
    background: var(--surface);
    color: #b91c1c;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    padding: 0.28rem 0.7rem;
  }
  .session-alert button:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  /* Mobile chat app-shell (JWPK IMG_0671 fix): on phones the room column
     uses page-level scrolling. iOS Safari is brittle when dynamic control
     rows live inside a fixed-height overflow:hidden shell: a slightly taller
     status/mode strip can consume the whole inner scroll area and make the
     page feel both stuck and over-zoomed. Keep the composer sticky, but let
     the document own vertical scrolling. Scoped ≤768px so the desktop grid
     layout is untouched; :global() reaches MessageList's scoped classes from
     this parent. */
  @media (max-width: 768px) {
    .room-grid {
      gap: 0;
    }
    .room-main {
      min-height: calc(100svh - 3.45rem - env(safe-area-inset-top, 0));
      gap: 0.35rem;
      overflow: visible;
    }
    .room-main :global(.message-list-wrapper) {
      display: block;
      min-height: 0;
    }
    .room-main :global(.message-list) {
      /* Page scroll owns vertical movement on mobile. The desktop list keeps
         its inner scroll; the phone list becomes natural document content so
         Safari gestures always have one obvious scroll target. */
      max-height: none;
      overflow-y: visible;
      padding: 0.42rem 0.48rem calc(5.8rem + env(safe-area-inset-bottom, 0));
      border-radius: 0.8rem;
    }
    .composer-dock {
      margin: 0 -0.15rem;
      padding: 0.15rem 0.15rem env(safe-area-inset-bottom, 0);
      background: var(--bg);
    }
    .session-alert {
      align-items: stretch;
      flex-direction: column;
      margin: 0.45rem 0.48rem;
    }
    .session-alert button {
      width: 100%;
    }
    .room-main :global(.room-mode-switcher),
    .room-main :global(.away-mode-bar),
    .room-main :global(.focus-strip) {
      flex: 0 0 auto;
    }
    .room-main :global(.room-mode-switcher),
    .room-main :global(.away-mode-toggle) {
      display: flex;
      gap: 0.25rem;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .room-main :global(.room-mode-switcher::-webkit-scrollbar),
    .room-main :global(.away-mode-toggle::-webkit-scrollbar) {
      display: none;
    }
    .room-main :global(.mode-pill),
    .room-main :global(.away-pill) {
      flex: 1 0 5.4rem;
      min-width: 5.4rem;
    }
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
</style>
