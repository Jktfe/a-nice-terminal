<script lang="ts">
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import { useGridStore } from '$lib/stores/grid.svelte';
  import { SESSIONS_CHANNEL } from '$lib/ws-channels';
  import SessionCard from './SessionCard.svelte';
  import TerminalRow from './TerminalRow.svelte';
  import GridView from './GridView.svelte';
  import DashboardHeader from './DashboardHeader.svelte';
  import ArchiveStrip from './ArchiveStrip.svelte';
  import { goto } from '$app/navigation';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';
  import {
    SIDEBAR_PIN_CHANGE_EVENT,
    SIDEBAR_PIN_STORAGE_KEY,
    notifySidebarPinsChanged,
    readPinnedIds,
    reorderPinnedIds,
    togglePinnedId,
    writePinnedIds,
  } from '$lib/utils/sidebar-pins';
  import { onMount } from 'svelte';
  import PersonalSettingsModal from './PersonalSettingsModal.svelte';
  import RemoteInviteModal from './RemoteInviteModal.svelte';

  const grid = useGridStore();
  const store = useSessionStore();

  let searchText = $state('');
  let creatingTerminal = $state(false);
  let creatingChat = $state(false);
  let showPersonalSettings = $state(false);
  let inviteSession = $state<{ id: string; name: string } | null>(null);
  type DashboardOrderMode = 'activity' | 'manual';
  type DashboardOrderSection = 'terminal' | 'chat';
  type DashboardTypeFilter = 'all' | 'terminals' | 'chats';
  type NeedsInputStatus = {
    eventClass: string;
    summary: string;
    source?: string;
    since?: string;
  };
  const ORDER_MODE_KEY = 'ant.dashboard.orderMode';
  const TYPE_FILTER_KEY = 'ant.dashboard.typeFilter';
  let orderMode = $state<DashboardOrderMode>('activity');
  let hasStoredOrderMode = $state(false);
  let typeFilter = $state<DashboardTypeFilter>('all');
  let draggedSession = $state<{ section: DashboardOrderSection; id: string } | null>(null);
  let dragOverSession = $state<{ section: DashboardOrderSection; id: string } | null>(null);
  let sidebarPinnedIds = $state<Set<string>>(new Set());
  let activeAskCount = $state(0);

  // ── Inline modal state (replaces window.prompt / confirm) ──
  let modal = $state<{
    mode: 'create-terminal' | 'create-chat' | 'confirm-delete';
    name: string;
    defaultName: string;
    error: string;
    /** For confirm-delete: the session to delete */
    targetSession?: any;
  } | null>(null);
  let modalInputEl = $state<HTMLInputElement | null>(null);

  function openCreateModal(type: 'terminal' | 'chat') {
    const defaultName = getUniqueName(type === 'terminal' ? 'Terminal' : 'Chat', type);
    modal = {
      mode: type === 'terminal' ? 'create-terminal' : 'create-chat',
      name: defaultName,
      defaultName,
      error: '',
    };
    // Focus after DOM update
    setTimeout(() => modalInputEl?.select(), 0);
  }

  function openDeleteModal(session: any) {
    modal = {
      mode: 'confirm-delete',
      name: session.name,
      defaultName: '',
      error: '',
      targetSession: session,
    };
  }

  async function submitCreateModal() {
    if (!modal || (modal.mode !== 'create-terminal' && modal.mode !== 'create-chat')) return;
    const trimmed = modal.name.trim();
    if (!trimmed) { modal.error = 'Name cannot be empty'; return; }
    const existing = store.sessions.find(s => s.name === trimmed);
    if (existing) { modal.error = `"${trimmed}" already exists`; return; }

    const isTerminal = modal.mode === 'create-terminal';
    if (isTerminal) creatingTerminal = true; else creatingChat = true;
    modal = null;

    try {
      const session = await store.createSession(trimmed, isTerminal ? 'terminal' : 'chat', isTerminal ? 'forever' : '15m');
      goto(`/session/${session.id}`);
    } catch (e) {
      // Re-open modal with error if creation fails
      modal = {
        mode: isTerminal ? 'create-terminal' : 'create-chat',
        name: trimmed,
        defaultName: trimmed,
        error: e instanceof Error ? e.message : 'Failed to create session',
      };
    } finally {
      creatingTerminal = false;
      creatingChat = false;
    }
  }

  async function submitDeleteModal() {
    if (!modal || modal.mode !== 'confirm-delete' || !modal.targetSession) return;
    const id = modal.targetSession.id;
    modal = null;
    await store.hardDeleteSession(id);
  }

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { modal = null; return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (modal?.mode === 'confirm-delete') submitDeleteModal();
      else submitCreateModal();
    }
  }

  // ── Dashboard WS for badge events ──────────────────────────────────
  // Track sessions that need input (pulsing indicator) and idle sessions (dimmer)
  let needsInputMap = $state(new Map<string, NeedsInputStatus>());
  let idleAttentionSet = $state(new Set<string>());
  const agentsWaitingCount = $derived(needsInputMap.size);

  let dashboardWs: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let dashboardLoadInFlight: Promise<void> | null = null;
  let lastDashboardLoadAt = 0;

  async function refreshNeedsInputStatuses(list = store.sessions) {
    const terminals = list.filter((session) => session.type === 'terminal');
    const terminalIds = new Set(terminals.map((session) => session.id));
    const next = new Map(needsInputMap);
    for (const id of terminalIds) next.delete(id);

    await Promise.all(terminals.map(async (terminal) => {
      try {
        const res = await fetch(`/api/sessions/${terminal.id}/status`);
        if (!res.ok) return;
        const status = await res.json();
        if (!status?.needs_input) return;
        next.set(terminal.id, {
          eventClass: status.event_class ?? 'prompt_bridge',
          summary: status.summary ?? 'Waiting for input',
          source: status.capture?.interactive_source,
          since: status.since,
        });
      } catch {}
    }));

    needsInputMap = next;
  }

  async function refreshAskCount() {
    try {
      // Match the /asks "Needs action" tab — only count truly actionable open
      // asks. Including candidate (auto-inferred) + deferred made the badge
      // surface 99+ even when the queue had ~25 real items requiring action.
      const res = await fetch('/api/asks?status=open&view=actionable&limit=500');
      if (!res.ok) return;
      const data = await res.json();
      activeAskCount = Array.isArray(data.asks) ? data.asks.length : 0;
    } catch {}
  }

  async function loadDashboardSessions(options: { force?: boolean } = {}) {
    if (dashboardLoadInFlight) return dashboardLoadInFlight;
    const now = Date.now();
    if (!options.force && now - lastDashboardLoadAt < 1_500) return;

    dashboardLoadInFlight = (async () => {
      await store.load();
      await refreshNeedsInputStatuses(store.sessions);
      await refreshAskCount();
      lastDashboardLoadAt = Date.now();
    })().finally(() => {
      dashboardLoadInFlight = null;
    });
    return dashboardLoadInFlight;
  }

  function connectDashboardWs() {
    if (typeof window === 'undefined') return;
    if (
      dashboardWs &&
      (dashboardWs.readyState === WebSocket.CONNECTING || dashboardWs.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    dashboardWs = new WebSocket(`${protocol}//${location.host}/ws`);

    dashboardWs.onopen = () => {
      dashboardWs?.send(JSON.stringify({ type: 'join_session', sessionId: SESSIONS_CHANNEL }));
    };

    dashboardWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'sessions_changed') {
          void loadDashboardSessions();
        } else if (msg.type === 'session_needs_input') {
          const next = new Map(needsInputMap);
          next.set(msg.sessionId, {
            eventClass: msg.eventClass,
            summary: msg.summary,
            source: msg.source,
            since: msg.since,
          });
          needsInputMap = next;
          // If it needs input, it's not just idle
          const nextIdle = new Set(idleAttentionSet);
          nextIdle.delete(msg.sessionId);
          idleAttentionSet = nextIdle;
        } else if (msg.type === 'session_input_resolved') {
          const next = new Map(needsInputMap);
          next.delete(msg.sessionId);
          needsInputMap = next;
        } else if (msg.type === 'session_idle_attention') {
          // Only show idle if not already needs-input
          if (!needsInputMap.has(msg.sessionId)) {
            const next = new Set(idleAttentionSet);
            next.add(msg.sessionId);
            idleAttentionSet = next;
          }
        } else if (msg.type === 'session_activity') {
          void store.load();
        } else if (msg.type === 'ask_created' || msg.type === 'ask_updated') {
          void refreshAskCount();
        }
      } catch {}
    };

    dashboardWs.onclose = () => {
      dashboardWs = null;
      wsReconnectTimer = setTimeout(connectDashboardWs, 3000);
    };
  }

  function refreshDashboardAfterWake() {
    if (typeof document !== 'undefined' && document.hidden) return;
    void loadDashboardSessions({ force: true });
    connectDashboardWs();
  }

  $effect(() => {
    connectDashboardWs();
    return () => {
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      dashboardWs?.close();
    };
  });

  const hasManualOrder = $derived(store.sessions.some((session) => typeof session.sort_index === 'number'));

  onMount(() => {
    const saved = localStorage.getItem(ORDER_MODE_KEY);
    if (saved === 'activity' || saved === 'manual') {
      orderMode = saved;
      hasStoredOrderMode = true;
    }
    const savedType = localStorage.getItem(TYPE_FILTER_KEY);
    if (savedType === 'all' || savedType === 'terminals' || savedType === 'chats') {
      typeFilter = savedType;
    }
    sidebarPinnedIds = readPinnedIds(localStorage);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SIDEBAR_PIN_STORAGE_KEY) sidebarPinnedIds = readPinnedIds(localStorage);
    };
    const handlePinChange = () => {
      sidebarPinnedIds = readPinnedIds(localStorage);
    };
    const handleVisibility = () => {
      if (!document.hidden) refreshDashboardAfterWake();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(SIDEBAR_PIN_CHANGE_EVENT, handlePinChange);
    window.addEventListener('pageshow', refreshDashboardAfterWake);
    window.addEventListener('online', refreshDashboardAfterWake);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SIDEBAR_PIN_CHANGE_EVENT, handlePinChange);
      window.removeEventListener('pageshow', refreshDashboardAfterWake);
      window.removeEventListener('online', refreshDashboardAfterWake);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  });

  function toggleSidebarPin(id: string) {
    if (typeof localStorage === 'undefined') return;
    sidebarPinnedIds = togglePinnedId(sidebarPinnedIds, id);
    writePinnedIds(sidebarPinnedIds, localStorage);
    notifySidebarPinsChanged();
  }

  function setTypeFilter(value: DashboardTypeFilter) {
    typeFilter = value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TYPE_FILTER_KEY, value);
    }
  }

  $effect(() => {
    if (!hasStoredOrderMode && hasManualOrder) {
      orderMode = 'manual';
    }
  });

  function setOrderMode(mode: DashboardOrderMode) {
    orderMode = mode;
    hasStoredOrderMode = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ORDER_MODE_KEY, mode);
    }
  }

  async function resetOrder() {
    setOrderMode('activity');
    await store.resetSessionOrder();
  }

  function timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const normalized = value.includes('Z') || value.includes('+') ? value : value.replace(' ', 'T') + 'Z';
    return new Date(normalized).getTime() || 0;
  }

  function activityCompare(a: any, b: any): number {
    return timestamp(b.updated_at) - timestamp(a.updated_at);
  }

  function manualCompare(a: any, b: any): number {
    const aOrder = typeof a.sort_index === 'number' ? a.sort_index : Number.MAX_SAFE_INTEGER;
    const bOrder = typeof b.sort_index === 'number' ? b.sort_index : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return activityCompare(a, b);
  }

  function sortDashboardSessions(list: any[]): any[] {
    return [...list].sort(orderMode === 'manual' ? manualCompare : activityCompare);
  }

  const filtered = $derived(
    sortDashboardSessions(store.sessions.filter(s =>
      s.name.toLowerCase().includes(searchText.toLowerCase())
    ))
  );

  const sidebarPinRank = $derived.by(() =>
    new Map(Array.from(sidebarPinnedIds).map((id, index) => [id, index]))
  );

  function sidebarPinCompare(a: any, b: any): number {
    const aRank = sidebarPinRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = sidebarPinRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  }

  // Split by type. Sidebar-pinned sessions float to the top in pin order;
  // everything else keeps the selected activity/manual ordering.
  const terminals = $derived([...filtered.filter(s => s.type === 'terminal')]
    .sort(sidebarPinCompare));
  const chats = $derived([...filtered.filter(s => s.type === 'chat')]
    .sort(sidebarPinCompare));

  // For each terminal, find its linked chat from the full (unfiltered) sessions list
  function linkedChatFor(terminal: any): any | null {
    if (!terminal.linked_chat_id) return null;
    return store.sessions.find(s => s.id === terminal.linked_chat_id) ?? null;
  }

  // Standalone chats — not linked to any terminal
  const linkedChatIds = $derived(new Set(
    store.sessions
      .filter(s => s.type === 'terminal' && s.linked_chat_id)
      .map(s => s.linked_chat_id as string)
  ));
  const standaloneChatsSrc = $derived(chats.filter(s => !linkedChatIds.has(s.id) && !isAutoLinkedChatSession(s)));

  function reorderById<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
    if (fromId === toId) return items;
    const next = [...items];
    const fromIndex = next.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return items;
    const [item] = next.splice(fromIndex, 1);
    const toIndex = next.findIndex((candidate) => candidate.id === toId);
    if (toIndex < 0) return items;
    next.splice(toIndex, 0, item);
    return next;
  }

  function buildDashboardOrderIds(nextTerminals = terminals, nextStandaloneChats = standaloneChatsSrc): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (id: string | null | undefined) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
    };

    for (const terminal of nextTerminals) {
      push(terminal.id);
      push(terminal.linked_chat_id);
    }
    for (const chat of nextStandaloneChats) {
      push(chat.id);
    }
    for (const session of sortDashboardSessions(store.sessions)) {
      push(session.id);
    }
    return ordered;
  }

  function handleDragStart(event: DragEvent, section: DashboardOrderSection, id: string) {
    if (orderMode !== 'manual') return;
    draggedSession = { section, id };
    event.dataTransfer?.setData('text/plain', id);
    event.dataTransfer?.setDragImage(event.currentTarget as Element, 10, 10);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event: DragEvent, section: DashboardOrderSection, id: string) {
    if (!draggedSession || draggedSession.section !== section || draggedSession.id === id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverSession = { section, id };
  }

  async function handleDrop(event: DragEvent, section: DashboardOrderSection, id: string) {
    event.preventDefault();
    if (!draggedSession || draggedSession.section !== section || draggedSession.id === id) {
      draggedSession = null;
      dragOverSession = null;
      return;
    }

    const fromId = draggedSession.id;
    const bothPinned = sidebarPinnedIds.has(fromId) && sidebarPinnedIds.has(id);

    // Reordering within the pin group is its own dimension — sidebarPinCompare
    // runs AFTER activity/manual sort, so updating sort_index alone wouldn't
    // move pinned items. Always update the pin Set when both endpoints are
    // pinned, regardless of mode.
    if (bothPinned && typeof localStorage !== 'undefined') {
      sidebarPinnedIds = reorderPinnedIds(sidebarPinnedIds, fromId, id);
      writePinnedIds(sidebarPinnedIds, localStorage);
      notifySidebarPinsChanged();
    }

    // Pin-only drag in activity mode: don't force manual mode or rewrite
    // sort_index — the user is reordering bookmarks, not the dashboard.
    if (bothPinned && orderMode !== 'manual') {
      draggedSession = null;
      dragOverSession = null;
      return;
    }

    const nextTerminals = section === 'terminal'
      ? reorderById(terminals, fromId, id)
      : terminals;
    const nextStandaloneChats = section === 'chat'
      ? reorderById(standaloneChatsSrc, fromId, id)
      : standaloneChatsSrc;

    draggedSession = null;
    dragOverSession = null;
    setOrderMode('manual');
    await store.reorderSessions(buildDashboardOrderIds(nextTerminals, nextStandaloneChats));
  }

  function handleDragEnd() {
    draggedSession = null;
    dragOverSession = null;
  }

  $effect(() => {
    void loadDashboardSessions();
  });

  function getUniqueName(base: string, type: string): string {
    const existing = new Set(store.sessions.filter(s => s.type === type).map(s => s.name));
    if (!existing.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base} ${i}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  function createTerminal() { openCreateModal('terminal'); }
  function createChat() { openCreateModal('chat'); }

  async function restoreArchived(id: string) {
    await store.restoreSession(id);
  }
</script>

<div class="flex flex-col h-screen w-screen overflow-hidden" style="background: var(--bg); color: var(--text);">

  <DashboardHeader
    {orderMode}
    {hasManualOrder}
    {typeFilter}
    {searchText}
    onSetOrderMode={setOrderMode}
    onResetOrder={resetOrder}
    onSetTypeFilter={setTypeFilter}
    onSetSearchText={(value) => { searchText = value; }}
    onTogglePersonalSettings={() => { showPersonalSettings = true; }}
    askCount={activeAskCount}
  />

  <!-- ── Grid view ──────────────────────────────────────────────── -->
  {#if grid.enabled}
    <div class="flex-1 min-h-0 overflow-hidden">
      <GridView sessions={store.sessions} {needsInputMap} {idleAttentionSet} />
    </div>

  {:else}
  <!-- ── List view ──────────────────────────────────────────────── -->


    <!-- ── Loading / error states ── -->
    {#if store.loading && store.sessions.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-sm" style="color: var(--text-muted);">Loading sessions…</p>
      </div>
    {:else if store.error}
      <div class="flex-1 flex flex-col items-center justify-center gap-4">
        <p class="font-medium" style="color: var(--text);">Failed to load sessions</p>
        <p class="text-sm max-w-xs text-center" style="color: var(--text-faint);">{store.error}</p>
        <button onclick={() => store.load()} class="text-[#22C55E] text-sm font-medium hover:text-[#4ADE80] transition-colors">Retry</button>
      </div>

    {:else}
    <!-- ── Two-column layout ──────────────────────────────────────── -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="flex flex-col lg:flex-row gap-6 lg:gap-8 p-4 sm:p-6 h-full">

        <!-- Terminals column — order-2 on mobile (below Chats), order-1 on desktop -->
        {#if typeFilter !== 'chats'}
        <div class="flex-1 min-w-0 order-2 lg:order-1">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4 gap-2">
            <h2 class="text-base font-semibold flex-shrink-0" style="color: var(--text);">
              Terminals
              {#if terminals.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{terminals.length}</span>
              {/if}
              {#if agentsWaitingCount > 0}
                <span
                  class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full"
                  style="background: rgba(239,68,68,0.12); color: #EF4444;"
                  title="{agentsWaitingCount} terminal agent{agentsWaitingCount === 1 ? '' : 's'} waiting for input"
                >{agentsWaitingCount} waiting</span>
              {/if}
            </h2>
            <button
              onclick={createTerminal}
              disabled={creatingTerminal}
              class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60 w-full sm:w-auto"
              style="background: #4F46E5;"
            >
              {#if creatingTerminal}
                <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="32" stroke-dashoffset="8" />
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 5v14M5 12h14"/>
                </svg>
              {/if}
              <span>New Terminal</span>
            </button>
          </div>

          <!-- Terminal pair cards -->
          {#if terminals.length === 0}
            <div class="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-dashed" style="border-color: var(--border-light);">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: rgba(79,70,229,0.1);">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5"></polyline>
                  <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
              </div>
              <p class="text-sm font-medium" style="color: var(--text-muted);">No terminals yet</p>
              <p class="text-xs" style="color: var(--text-faint);">Click "New Terminal" to get started</p>
            </div>
          {:else}
            <div class="space-y-2.5">
              {#each terminals as terminal (terminal.id)}
                <div
                  class="animate-slide-in dashboard-order-row"
                  class:drag-over={dragOverSession?.section === 'terminal' && dragOverSession.id === terminal.id}
                  role="listitem"
                  ondragover={(event) => handleDragOver(event, 'terminal', terminal.id)}
                  ondrop={(event) => handleDrop(event, 'terminal', terminal.id)}
                >
                  <div class="flex items-stretch gap-2">
                    {#if orderMode === 'manual' || sidebarPinnedIds.has(terminal.id)}
                      <button
                        type="button"
                        class="drag-handle"
                        class:drag-handle-pin={orderMode !== 'manual' && sidebarPinnedIds.has(terminal.id)}
                        draggable="true"
                        ondragstart={(event) => handleDragStart(event, 'terminal', terminal.id)}
                        ondragend={handleDragEnd}
                        onclick={(event) => event.stopPropagation()}
                        title={sidebarPinnedIds.has(terminal.id) && orderMode !== 'manual' ? 'Drag to reorder bookmark' : 'Drag to reorder'}
                        aria-label="Drag terminal to reorder"
                      >
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/>
                          <circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/>
                          <circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/>
                        </svg>
                      </button>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <TerminalRow
                        {terminal}
                        linkedChat={linkedChatFor(terminal)}
                        needsInput={needsInputMap.get(terminal.id) ?? null}
                        idleAttention={idleAttentionSet.has(terminal.id)}
                        onArchive={() => store.archiveSession(terminal.id)}
                        onDelete={() => store.deleteSession(terminal.id)}
                        pinnedToSidebar={sidebarPinnedIds.has(terminal.id)}
                        onTogglePin={(t) => toggleSidebarPin(t.id)}
                      />
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        {/if}

        {#if typeFilter === 'all'}
          <!-- Vertical divider (desktop only) -->
          <div class="hidden lg:block w-px flex-shrink-0 self-stretch" style="background: var(--border-light);"></div>

          <!-- Horizontal divider (mobile only) -->
          <div class="lg:hidden h-px w-full order-15" style="background: var(--border-light);"></div>
        {/if}

        <!-- Chats column — order-1 on mobile (first), order-2 on desktop -->
        {#if typeFilter !== 'terminals'}
        <div class="flex-1 min-w-0 order-1 lg:order-2">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4 gap-2">
            <h2 class="text-base font-semibold flex-shrink-0" style="color: var(--text);">
              Chats
              {#if standaloneChatsSrc.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{standaloneChatsSrc.length}</span>
              {/if}
            </h2>
            <button
              onclick={createChat}
              disabled={creatingChat}
              class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60 w-full sm:w-auto"
              style="background: #10B981;"
            >
              {#if creatingChat}
                <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="32" stroke-dashoffset="8" />
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 5v14M5 12h14"/>
                </svg>
              {/if}
              <span>New Chat</span>
            </button>
          </div>

          <!-- Chat cards (standalone only) -->
          {#if standaloneChatsSrc.length === 0}
            <div class="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed" style="border-color: var(--border-light);">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: rgba(16,185,129,0.1);">
                <!-- message-square icon -->
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <p class="text-sm font-medium" style="color: var(--text-muted);">No standalone chats</p>
              <p class="text-xs text-center max-w-[180px]" style="color: var(--text-faint);">Linked chats open via their terminal pair card</p>
            </div>
          {:else}
            <div class="space-y-2">
              {#each standaloneChatsSrc as chat (chat.id)}
                <div
                  class="animate-slide-in dashboard-order-row"
                  class:drag-over={dragOverSession?.section === 'chat' && dragOverSession.id === chat.id}
                  role="listitem"
                  ondragover={(event) => handleDragOver(event, 'chat', chat.id)}
                  ondrop={(event) => handleDrop(event, 'chat', chat.id)}
                >
                  <div class="flex items-stretch gap-2">
                    {#if orderMode === 'manual' || sidebarPinnedIds.has(chat.id)}
                      <button
                        type="button"
                        class="drag-handle"
                        class:drag-handle-pin={orderMode !== 'manual' && sidebarPinnedIds.has(chat.id)}
                        draggable="true"
                        ondragstart={(event) => handleDragStart(event, 'chat', chat.id)}
                        ondragend={handleDragEnd}
                        onclick={(event) => event.stopPropagation()}
                        title={sidebarPinnedIds.has(chat.id) && orderMode !== 'manual' ? 'Drag to reorder bookmark' : 'Drag to reorder'}
                        aria-label="Drag chat to reorder"
                      >
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/>
                          <circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/>
                          <circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/>
                        </svg>
                      </button>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <SessionCard
                        session={chat}
                        onclick={() => goto(`/session/${chat.id}`)}
                        onArchive={() => store.archiveSession(chat.id)}
                        onDelete={() => store.deleteSession(chat.id)}
                        onInvite={() => { inviteSession = { id: chat.id, name: chat.name || chat.id }; }}
                        pinnedToSidebar={sidebarPinnedIds.has(chat.id)}
                        onTogglePin={(s: any) => toggleSidebarPin(s.id)}
                      />
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        {/if}

      </div>
    </div>

    <ArchiveStrip
      recoverable={store.recoverable}
      onRestore={restoreArchived}
      onDelete={openDeleteModal}
    />
    {/if}

  {/if}

  {#if inviteSession}
    <RemoteInviteModal
      sessionId={inviteSession.id}
      sessionName={inviteSession.name}
      onClose={() => { inviteSession = null; }}
    />
  {/if}

  {#if showPersonalSettings}
    <PersonalSettingsModal onClose={() => { showPersonalSettings = false; }} />
  {/if}

  <!-- ── Inline modal (replaces prompt/confirm) ── -->
  {#if modal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
      onkeydown={handleModalKeydown}
      onmousedown={(e) => { if (e.target === e.currentTarget) modal = null; }}
    >
      <div
        class="w-full max-w-sm mx-4 rounded-xl border shadow-2xl"
        style="background: var(--bg-card, #1A1A22); border-color: var(--border-light, #ffffff10);"
      >
        {#if modal.mode === 'confirm-delete'}
          <!-- Delete confirmation -->
          <div class="p-5">
            <h3 class="text-sm font-semibold mb-2" style="color: var(--text);">Delete permanently?</h3>
            <p class="text-xs mb-4" style="color: var(--text-muted);">
              Delete "<strong>{modal.name}</strong>" permanently? This cannot be undone.
            </p>
            <div class="flex justify-end gap-2">
              <button
                onclick={() => { modal = null; }}
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style="color: var(--text-muted); background: var(--bg-elevated, #ffffff08);"
              >Cancel</button>
              <button
                onclick={submitDeleteModal}
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                style="background: #EF4444;"
              >Delete</button>
            </div>
          </div>
        {:else}
          <!-- Create terminal / chat -->
          <div class="p-5">
            <h3 class="text-sm font-semibold mb-3" style="color: var(--text);">
              {modal.mode === 'create-terminal' ? 'New Terminal' : 'New Chat'}
            </h3>
            <input
              bind:this={modalInputEl}
              bind:value={modal.name}
              placeholder={modal.defaultName}
              class="w-full px-3 py-2 rounded-lg text-sm outline-none mb-1"
              style="background: var(--bg, #0A1628); border: 1px solid {modal.error ? '#EF4444' : 'var(--border-subtle, #ffffff10)'}; color: var(--text);"
            />
            {#if modal.error}
              <p class="text-xs mt-1 mb-2" style="color: #EF4444;">{modal.error}</p>
            {/if}
            <div class="flex justify-end gap-2 mt-3">
              <button
                onclick={() => { modal = null; }}
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style="color: var(--text-muted); background: var(--bg-elevated, #ffffff08);"
              >Cancel</button>
              <button
                onclick={submitCreateModal}
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                style="background: {modal.mode === 'create-terminal' ? '#4F46E5' : '#10B981'};"
              >Create</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .dashboard-order-row {
    border-radius: var(--radius-card);
    transition: outline-color var(--duration-base) var(--spring-quick),
      background-color var(--duration-base) var(--spring-quick);
  }

  .dashboard-order-row.drag-over {
    outline: 1.5px solid #6366F1;
    outline-offset: 3px;
    background: rgba(99, 102, 241, 0.08);
  }

  .drag-handle {
    width: 32px;
    min-height: 44px;
    border: 0.5px solid var(--border-light);
    border-radius: 10px;
    background: var(--bg-elevated);
    color: var(--text-faint);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }

  .drag-handle:active {
    cursor: grabbing;
    color: #6366F1;
  }

  /* When the handle appears for a pinned item in activity mode, hint that
     it's a bookmark-only reorder by tinting the handle the pin colour
     (matches TerminalRow's amber-on-active pin icon). */
  .drag-handle-pin {
    border-color: rgba(245, 158, 11, 0.35);
    color: #F59E0B;
  }
</style>
