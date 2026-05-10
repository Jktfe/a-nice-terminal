<script lang="ts">
  import { goto } from '$app/navigation';
  import { NOCTURNE, agentColorFromSession } from '$lib/nocturne';
  import { SESSIONS_CHANNEL } from '$lib/ws-channels';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';
  import {
    SIDEBAR_PIN_CHANGE_EVENT,
    SIDEBAR_PIN_STORAGE_KEY,
    notifySidebarPinsChanged,
    readPinnedIds,
    togglePinnedId,
    writePinnedIds,
  } from '$lib/utils/sidebar-pins';
  import { deriveTerminalActivityState } from '$lib/shared/terminal-activity';
  import AgentDot from './AgentDot.svelte';
  import { onMount, onDestroy } from 'svelte';

  interface RailSession {
    id: string;
    name: string;
    type: string;
    handle?: string | null;
    display_name?: string | null;
    cli_flag?: string | null;
    status?: string;
    ttl?: string | null;
    last_activity?: string;
    updated_at?: string;
    linked_chat_id?: string | null;
    attention_state?: string | null;
    attention_reason?: string | null;
    focus_room_name?: string | null;
    focus_queue_count?: number | null;
    meta?: string | Record<string, unknown> | null;
  }
  type NeedsInputStatus = {
    eventClass: string;
    summary: string;
    source?: string;
    since?: string;
  };

  let { currentSessionId }: { currentSessionId: string } = $props();

  let sessions = $state<RailSession[]>([]);
  let needsInputMap = $state(new Map<string, NeedsInputStatus>());
  let idleAttentionSet = $state(new Set<string>());
  let unreadSet = $state(new Set<string>());
  let hoveredId = $state<string | null>(null);
  let tooltipPos = $state<{ top: number; left: number } | null>(null);
  let compactPhoneRail = $state(false);
  let compactRailExpanded = $state(false);
  let stopCompactRailListener: (() => void) | null = null;
  const MOBILE_RAIL_EXPANDED_KEY = 'ant.activityRail.mobileExpanded';

  // B5 — explicit sidebar pinning. Persistence stays client-local for now:
  // no schema/API changes, and TTL remains session persistence rather than pin state.
  let pinnedIds = $state<Set<string>>(new Set());

  function isCompactPhoneRail() {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  }

  function loadPinned() {
    if (typeof window === 'undefined') return;
    pinnedIds = readPinnedIds(localStorage);
  }

  function loadCompactRailPreference() {
    if (typeof window === 'undefined') return;
    compactRailExpanded = localStorage.getItem(MOBILE_RAIL_EXPANDED_KEY) === '1';
  }

  function savePinned() {
    if (typeof window === 'undefined') return;
    writePinnedIds(pinnedIds, localStorage);
    notifySidebarPinsChanged();
  }

  function togglePin(sessionId: string) {
    pinnedIds = togglePinnedId(pinnedIds, sessionId);
    savePinned();
  }

  function toggleCompactRail() {
    compactRailExpanded = !compactRailExpanded;
    if (typeof window !== 'undefined') {
      localStorage.setItem(MOBILE_RAIL_EXPANDED_KEY, compactRailExpanded ? '1' : '0');
    }
  }

  function onStorageEvent(e: StorageEvent) {
    if (e.key === SIDEBAR_PIN_STORAGE_KEY) loadPinned();
  }

  // Agent telemetry — model, context %, state from CLI status lines
  interface AgentTelemetry {
    model?: string;
    contextUsedPct?: number;
    rateLimitPct?: string;
    state: string;
    activity?: string;
    waitingFor?: string;
    focus?: { roomName?: string | null; queueCount?: number | null; reason?: string | null };
  }
  let agentStatusMap = $state(new Map<string, AgentTelemetry>());

  // Load sessions
  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      const rows = (data.sessions || []).filter((s: RailSession) => s.status !== 'archived');
      sessions = rows;
      if (compactPhoneRail) {
        // Keep the at-a-glance phone rail cheap: the full needs-input fanout
        // hits every terminal status route and belongs to desktop width.
        needsInputMap = new Map();
      } else {
        void refreshNeedsInputStatuses(rows);
      }
    } catch {}
  }

  async function refreshNeedsInputStatuses(rows: RailSession[] = sessions) {
    const terminals = rows.filter((session) => session.type === 'terminal');
    const terminalIds = new Set(terminals.map((session) => session.id));
    const next = new Map(needsInputMap);
    for (const id of terminalIds) next.delete(id);

    await Promise.all(terminals.map(async (terminal) => {
      try {
        const res = await fetch(`/api/sessions/${terminal.id}/status`);
        if (!res.ok) return;
        const status = await res.json();
        if (!status?.needs_input) return;
        if (!terminalHasCliDriver(terminal)) return;
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

  function parseMeta(meta: unknown): Record<string, unknown> {
    if (!meta) return {};
    if (typeof meta === 'object') return meta as Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(meta));
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  function terminalHasCliDriver(session: RailSession | undefined | null): boolean {
    if (!session || session.type !== 'terminal') return false;
    if (typeof session.cli_flag === 'string' && session.cli_flag.trim()) return true;
    const meta = parseMeta(session.meta);
    return ['agent_driver', 'driver'].some((key) => typeof meta[key] === 'string' && String(meta[key]).trim());
  }

  // WS connection for live updates
  let ws: WebSocket | null = null;
  let wsDestroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connectWs() {
    if (wsDestroyed || typeof window === 'undefined') return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'join_session', sessionId: SESSIONS_CHANNEL }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'sessions_changed') {
          loadSessions();
        } else if (msg.type === 'session_needs_input') {
          const target = sessions.find((s) => s.id === msg.sessionId);
          if (!terminalHasCliDriver(target)) return;
          const next = new Map(needsInputMap);
          next.set(msg.sessionId, {
            eventClass: msg.eventClass,
            summary: msg.summary,
            source: msg.source,
            since: msg.since,
          });
          needsInputMap = next;
          const nextIdle = new Set(idleAttentionSet);
          nextIdle.delete(msg.sessionId);
          idleAttentionSet = nextIdle;
        } else if (msg.type === 'session_input_resolved') {
          const next = new Map(needsInputMap);
          next.delete(msg.sessionId);
          needsInputMap = next;
        } else if (msg.type === 'session_idle_attention') {
          if (!needsInputMap.has(msg.sessionId)) {
            const next = new Set(idleAttentionSet);
            next.add(msg.sessionId);
            idleAttentionSet = next;
          }
        } else if (msg.type === 'agent_status_updated') {
          const next = new Map(agentStatusMap);
          next.set(msg.sessionId, msg.status);
          agentStatusMap = next;
        } else if (msg.type === 'session_activity') {
          sessions = sessions.map((s) => s.id === msg.sessionId
            ? { ...s, last_activity: msg.last_activity ?? s.last_activity, status: 'active' }
            : s);
        } else if (msg.type === 'message_created') {
          // Mark other sessions as having unread activity
          if (msg.sessionId && msg.sessionId !== currentSessionId) {
            const next = new Set(unreadSet);
            next.add(msg.sessionId);
            unreadSet = next;
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      ws = null;
      if (!wsDestroyed) reconnectTimer = setTimeout(connectWs, 3000);
    };
  }

  // Client-side navigation — session page uses $effect on sessionId to
  // reset state, reconnect WS, and reload data on route changes.
  function navigationTarget(s: RailSession): string {
    return s.type === 'terminal' && s.linked_chat_id ? s.linked_chat_id : s.id;
  }

  function navigateTo(sessionId: string, sourceSessionId = sessionId) {
    const next = new Set(unreadSet);
    next.delete(sessionId);
    next.delete(sourceSessionId);
    unreadSet = next;
    goto(`/session/${sessionId}`);
  }

  function openFirstWaiting() {
    if (!firstWaitingSessionId) return;
    const waiting = sessions.find((s) => s.id === firstWaitingSessionId);
    if (!waiting) return;
    navigateTo(navigationTarget(waiting), waiting.id);
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      const media = window.matchMedia('(max-width: 640px)');
      const syncCompactRail = () => {
        const next = media.matches;
        if (compactPhoneRail === next) return;
        compactPhoneRail = next;
        hoveredId = null;
        tooltipPos = null;
        void loadSessions();
      };
      compactPhoneRail = isCompactPhoneRail();
      media.addEventListener('change', syncCompactRail);
      stopCompactRailListener = () => media.removeEventListener('change', syncCompactRail);
    }
    loadSessions();
    connectWs();
    loadPinned();
    loadCompactRailPreference();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorageEvent);
      window.addEventListener(SIDEBAR_PIN_CHANGE_EVENT, loadPinned);
    }
  });

  onDestroy(() => {
    wsDestroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    stopCompactRailListener?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorageEvent);
      window.removeEventListener(SIDEBAR_PIN_CHANGE_EVENT, loadPinned);
    }
  });

  // Standalone chatrooms always visible; terminals/linked chats only when needs-input
  const standaloneChatIds = $derived(new Set(
    sessions.filter(s =>
      s.type === 'chat' &&
      !isAutoLinkedChatSession(s) &&
      !sessions.some(t => t.type === 'terminal' && t.linked_chat_id === s.id)
    )
      .map(s => s.id)
  ));
  const standaloneChats = $derived(sessions.filter(s => standaloneChatIds.has(s.id)));
  const waitingSessions = $derived(
    sessions.filter(s => terminalHasCliDriver(s) && needsInputMap.has(s.id))
  );
  const waitingCount = $derived(waitingSessions.length);
  const firstWaitingSessionId = $derived(waitingSessions[0]?.id ?? null);
  const needsAttentionTerminals = $derived(
    sessions.filter(s => s.type === 'terminal' && ((terminalHasCliDriver(s) && needsInputMap.has(s.id)) || s.attention_state === 'focus'))
  );
  // Always show current session regardless of type
  const currentSession = $derived(sessions.find(s => s.id === currentSessionId));
  const orderedSessions = $derived.by(() => {
    const ids = new Set<string>();
    const result: RailSession[] = [];
    // Current session first (if not already in a visible group)
    if (currentSession && !standaloneChatIds.has(currentSession.id)) {
      result.push(currentSession);
      ids.add(currentSession.id);
    }
    // Terminals needing input
    for (const s of needsAttentionTerminals) {
      if (!ids.has(s.id)) { result.push(s); ids.add(s.id); }
    }
    // Standalone chatrooms
    for (const s of standaloneChats) {
      if (!ids.has(s.id)) { result.push(s); ids.add(s.id); }
    }
    return result.filter(s => !pinnedIds.has(s.id));
  });

  const pinnedSessions = $derived.by(() => {
    const order = Array.from(pinnedIds);
    const byId = new Map(sessions.map(s => [s.id, s] as const));
    return order
      .map(id => byId.get(id))
      .filter((s): s is RailSession => Boolean(s));
  });

  function agentId(s: RailSession): string | null {
    return s.cli_flag || s.handle?.replace('@', '') || null;
  }

  function sessionStatus(s: RailSession): 'active' | 'thinking' | 'idle' {
    if (terminalHasCliDriver(s) && needsInputMap.has(s.id)) return 'thinking';
    if (s.attention_state === 'focus') return 'active';
    if (s.last_activity) {
      const activity = deriveTerminalActivityState(s.last_activity);
      if (activity.state !== 'idle') return 'active';
    }
    return s.status === 'active' ? 'active' : 'idle';
  }

  function truncateName(name: string, max: number = 12): string {
    return name.length > max ? name.slice(0, max - 1) + '\u2026' : name;
  }

  function railLabel(s: RailSession): string {
    return truncateName(s.handle || s.display_name || s.name || s.id, 18);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="activity-rail {compactRailExpanded ? 'compact-expanded' : ''}"
  style="
    --rail-bg: var(--bg-surface);
    --rail-border: var(--border-light);
  "
  role="navigation"
  aria-label="Sessions"
>
  <!-- Home link — back to dashboard. Anchor (not button) so right-click → "Open in new tab" works. -->
  <a
    class="rail-item rail-home"
    href="/"
    title="Dashboard"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
    <span class="rail-label">Dashboard</span>
  </a>

  <button
    type="button"
    class="rail-expand-toggle"
    aria-label={compactRailExpanded ? 'Collapse session rail' : 'Expand session rail'}
    aria-expanded={compactRailExpanded}
    title={compactRailExpanded ? 'Collapse session rail' : 'Expand session rail'}
    onclick={toggleCompactRail}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if compactRailExpanded}
        <path d="M15 18l-6-6 6-6" />
      {:else}
        <path d="M9 18l6-6-6-6" />
      {/if}
    </svg>
  </button>

  <div class="rail-divider"></div>

  {#if waitingCount > 0}
    <button
      class="rail-waiting-counter"
      onclick={openFirstWaiting}
      title="{waitingCount} CLI terminal{waitingCount === 1 ? '' : 's'} waiting for input"
      aria-label="{waitingCount} CLI terminal{waitingCount === 1 ? '' : 's'} waiting for input"
    >{waitingCount}</button>

    <div class="rail-divider rail-divider--tight"></div>
  {/if}

  <!-- Session items -->
  <div class="rail-sessions">
    {#if pinnedSessions.length}
      {#each pinnedSessions as sess (sess.id)}
        {@render railItem(sess, true)}
      {/each}
      {#if orderedSessions.length}
        <div class="rail-pin-divider" aria-hidden="true"></div>
      {/if}
    {/if}
    {#each orderedSessions as sess (sess.id)}
      {@render railItem(sess, false)}
    {/each}
  </div>

  <!-- Fixed tooltip (outside scroll container to avoid clipping) -->
  {#if hoveredId && tooltipPos}
    {@const sess = pinnedSessions.find(s => s.id === hoveredId) ?? orderedSessions.find(s => s.id === hoveredId)}
    {#if sess}
      {@const agent = agentColorFromSession(sess)}
      {@const hasNeedsInput = terminalHasCliDriver(sess) && needsInputMap.has(sess.id)}
      {@const hasFocus = sess.attention_state === 'focus'}
      {@const telemetry = agentStatusMap.get(sess.id)}
      <div
        class="rail-tooltip"
        style="
          top: {tooltipPos.top}px;
          left: {tooltipPos.left}px;
          border-left: 3px solid {agent.color};
        "
      >
        <span class="rail-tooltip-name">{sess.display_name || sess.name}</span>
        {#if sess.handle}
          <span class="rail-tooltip-handle">{sess.handle}</span>
        {/if}
        {#if hasNeedsInput}
          <span class="rail-tooltip-type" style="color: {NOCTURNE.semantic.danger};">
            Needs input: {needsInputMap.get(sess.id)?.summary ?? 'waiting for you'}
          </span>
        {:else if hasFocus}
          <span class="rail-tooltip-type" style="color: {NOCTURNE.amber[500]};">
            Focus mode{sess.focus_room_name ? ` in ${sess.focus_room_name}` : ''} · {sess.focus_queue_count || 0} queued
          </span>
        {:else}
          <span class="rail-tooltip-type">
            {sess.type === 'terminal' ? '>' : '#'}
            {sess.type}
          </span>
        {/if}
        {#if telemetry}
          <span class="rail-tooltip-telemetry">
            {#if telemetry.model}{telemetry.model}{/if}
            {#if telemetry.contextUsedPct != null} · ctx {telemetry.contextUsedPct}%{/if}
            {#if telemetry.state === 'ready'} · Ready{:else if telemetry.state === 'busy'} · Busy{:else if telemetry.state === 'thinking'} · Thinking{:else if telemetry.state === 'focus'} · Focus{/if}
            {#if telemetry.activity} — {telemetry.activity}{/if}
            {#if telemetry.waitingFor}
              <br><span style="color: {NOCTURNE.amber[400]};">⏳ {telemetry.waitingFor}</span>
            {/if}
          </span>
        {/if}
      </div>
    {/if}
  {/if}

</div>

{#snippet railItem(sess: RailSession, isPinned: boolean)}
  {@const isCurrent = sess.id === currentSessionId}
  {@const agent = agentColorFromSession(sess)}
  {@const hasNeedsInput = terminalHasCliDriver(sess) && needsInputMap.has(sess.id)}
  {@const hasIdleAttention = idleAttentionSet.has(sess.id)}
  {@const hasUnread = unreadSet.has(sess.id)}
  {@const hasFocus = sess.attention_state === 'focus'}
  {@const aid = agentId(sess)}
  {@const isHovered = hoveredId === sess.id}

  <div class="rail-item-wrapper" class:pinned={isPinned}>
    <a
      class="rail-item"
      class:current={isCurrent}
      aria-current={isCurrent ? 'page' : undefined}
      href="/session/{navigationTarget(sess)}"
      onclick={(e: MouseEvent) => {
        // Preserve modifier-click and middle-click defaults so the browser
        // opens new tabs / windows. Plain left-click runs the bookkeeping
        // (clearing unread) AND lets SvelteKit do its own SPA nav off the
        // href, so we don't double-call goto.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const next = new Set(unreadSet);
        next.delete(navigationTarget(sess));
        next.delete(sess.id);
        unreadSet = next;
      }}
      onmouseenter={(e: MouseEvent) => {
        hoveredId = sess.id;
        const el = e.currentTarget;
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          tooltipPos = { top: rect.top + rect.height / 2, left: rect.right + 12 };
        } else {
          tooltipPos = { top: e.clientY, left: 68 };
        }
      }}
      onmouseleave={() => { hoveredId = null; tooltipPos = null; }}
      title="{sess.display_name || sess.name}{sess.linked_chat_id ? ' — open linked chat' : ''}{hasNeedsInput ? ' — needs input' : ''}{hasFocus ? ' — focus mode' : ''}{isPinned ? ' — pinned' : ''}"
      style="
        --agent-color: {agent.color};
        --agent-glow: {agent.glow};
      "
    >
      {#if isCurrent}
        <div class="rail-active-bar" style="background: {agent.color};"></div>
      {/if}
      {#if isPinned}
        <div class="rail-pin-marker" aria-hidden="true" title="Pinned"></div>
      {/if}

      <div class="rail-dot" class:rail-dot-current={isCurrent}>
        {#if aid}
          <AgentDot id={aid} size={isCurrent ? 14 : 12} state={sessionStatus(sess)} ring={false} />
        {:else}
          <div
            class="rail-type-dot"
            style="
              width: {isCurrent ? 28 : 24}px;
              height: {isCurrent ? 28 : 24}px;
              background: {agent.color}22;
              border: 1.5px solid {agent.color}55;
              box-shadow: {isCurrent ? `0 0 10px ${agent.color}44` : 'none'};
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: {isCurrent ? 11 : 10}px;
              font-weight: 700;
              color: {agent.color};
              font-family: var(--font-mono);
            "
          >{sess.type === 'terminal' ? '>' : '#'}</div>
        {/if}
      </div>
      <span class="rail-label">{railLabel(sess)}</span>

      {#if hasNeedsInput}
        <div class="rail-badge rail-badge-urgent" title="Needs input — {needsInputMap.get(sess.id)?.summary ?? 'waiting for you'}"></div>
      {:else if hasFocus}
        <div class="rail-badge rail-badge-focus" title="Focus mode — {sess.focus_queue_count || 0} queued"></div>
      {:else if hasUnread && !isCurrent}
        <div class="rail-badge rail-badge-unread" title="Unread activity"></div>
      {:else if hasIdleAttention}
        <div class="rail-badge rail-badge-idle" title="Idle — no recent activity"></div>
      {/if}
    </a>

    {#if isHovered}
      <button
        class="rail-pin-btn"
        type="button"
        aria-label={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
        title={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
        onclick={(e) => { e.stopPropagation(); togglePin(sess.id); }}
      >
        {#if isPinned}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        {:else}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>
{/snippet}

<style>
  .activity-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: calc(56px + var(--ant-safe-left, 0px));
    height: 100%;
    background: var(--rail-bg);
    border-right: 1px solid var(--rail-border);
    padding: 8px 0 8px var(--ant-safe-left, 0px);
    flex-shrink: 0;
    overflow: visible;
    transition: width var(--duration-base) var(--spring-default);
    z-index: 30;
  }

  .rail-divider {
    width: 24px;
    height: 1px;
    background: var(--border-light);
    margin: 6px 0;
    flex-shrink: 0;
  }

  .rail-divider--tight {
    margin: 4px 0;
  }

  .rail-waiting-counter {
    width: 28px;
    height: 24px;
    border: 0.5px solid rgba(239, 68, 68, 0.35);
    border-radius: 7px;
    background: rgba(239, 68, 68, 0.12);
    color: #EF4444;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.16);
  }

  .rail-waiting-counter:hover {
    background: rgba(239, 68, 68, 0.18);
  }

  .rail-sessions {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
    scrollbar-width: none;
  }

  .rail-sessions::-webkit-scrollbar {
    display: none;
  }

  .rail-item-wrapper {
    position: relative;
  }

  .rail-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-card);
    background: transparent;
    border: none;
    cursor: pointer;
    /* element is <a href>; reset default link styling */
    color: inherit;
    text-decoration: none;
    transition: background var(--duration-fast) var(--spring-default),
                transform var(--duration-fast) var(--spring-quick);
  }

  .rail-item:hover {
    background: var(--border-light);
    transform: scale(1.05);
  }

  .rail-item.current {
    background: color-mix(in srgb, var(--agent-color) 12%, transparent);
  }

  .rail-home {
    flex-shrink: 0;
  }

  .rail-active-bar {
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 20px;
    border-radius: 0 3px 3px 0;
    transition: height var(--duration-base) var(--spring-default);
  }

  .rail-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none; /* let parent button handle clicks — AgentDot glow extends beyond bounds */
  }

  .rail-label {
    display: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 650;
    color: var(--text);
    letter-spacing: 0;
    pointer-events: none;
  }

  .rail-expand-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    border: 0.5px solid var(--border-light);
    border-radius: 8px;
    background: var(--bg-card);
    color: var(--text-muted);
    cursor: pointer;
  }

  .rail-type-dot {
    border-radius: 50%;
    pointer-events: none;
    transition: width var(--duration-fast) var(--spring-default),
                height var(--duration-fast) var(--spring-default),
                box-shadow var(--duration-base) var(--spring-default);
  }

  /* Badges */
  .rail-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    border-radius: 50%;
    pointer-events: none;
  }

  .rail-badge-urgent {
    width: 8px;
    height: 8px;
    background: #EF4444;
    box-shadow: 0 0 6px #EF444488;
    animation: rail-pulse 1.5s ease-in-out infinite;
  }

  .rail-badge-unread {
    width: 7px;
    height: 7px;
    background: var(--blue-500);
    box-shadow: 0 0 4px rgba(59, 130, 246, 0.4);
  }

  .rail-badge-focus {
    width: 8px;
    height: 8px;
    background: var(--amber-400);
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.55);
  }

  .rail-badge-idle {
    width: 6px;
    height: 6px;
    background: var(--amber-400);
    opacity: 0.6;
  }

  @keyframes rail-fade-in {
    from { opacity: 0; transform: translateY(-50%) translateX(-4px); }
    to { opacity: 1; transform: translateY(-50%) translateX(0); }
  }

  @keyframes rail-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.4); }
  }

  /* Tooltip */
  .rail-tooltip {
    position: fixed;
    transform: translateY(-50%);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: 8px;
    padding: 6px 10px;
    white-space: nowrap;
    z-index: 50;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    pointer-events: none;
    animation: rail-fade-in 0.15s ease-out forwards;
  }

  .rail-tooltip-name {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-sans);
    letter-spacing: -0.01em;
  }

  .rail-tooltip-handle {
    display: block;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    margin-top: 1px;
  }

  .rail-tooltip-type {
    display: block;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-faint);
    margin-top: 2px;
  }

  .rail-tooltip-telemetry {
    display: block;
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    margin-top: 3px;
    padding-top: 3px;
    border-top: 1px solid var(--border-light);
  }

  /* Compact phone rail: keep the useful at-a-glance agent/session strip
     without spending desktop-only status fanout or tooltip space. */
  @media (max-width: 640px) {
    .activity-rail {
      display: flex;
      width: calc(44px + var(--ant-safe-left, 0px));
      min-width: calc(44px + var(--ant-safe-left, 0px));
      padding: 6px 0 6px var(--ant-safe-left, 0px);
      z-index: 35;
    }

    .activity-rail.compact-expanded {
      width: min(172px, calc(74vw + var(--ant-safe-left, 0px)));
      min-width: min(172px, calc(74vw + var(--ant-safe-left, 0px)));
      align-items: stretch;
      box-shadow: 10px 0 24px rgba(0, 0, 0, 0.12);
    }

    .rail-expand-toggle {
      display: flex;
      flex-shrink: 0;
      margin: 4px auto 0;
    }

    .rail-sessions {
      gap: 2px;
      padding: 2px 0;
    }

    .rail-item {
      width: 34px;
      height: 34px;
      border-radius: 10px;
    }

    .activity-rail.compact-expanded .rail-sessions {
      align-items: stretch;
      padding-right: 6px;
    }

    .activity-rail.compact-expanded .rail-item-wrapper {
      width: 100%;
    }

    .activity-rail.compact-expanded .rail-item {
      width: 100%;
      justify-content: flex-start;
      gap: 8px;
      padding: 0 9px;
    }

    .activity-rail.compact-expanded .rail-label {
      display: block;
    }

    .activity-rail.compact-expanded .rail-home {
      width: calc(100% - 6px);
      margin-right: 6px;
    }

    .rail-divider {
      width: 18px;
      margin: 4px 0;
    }

    .rail-waiting-counter {
      width: 26px;
      height: 22px;
      font-size: 10px;
    }

    .rail-active-bar {
      left: -5px;
      height: 18px;
    }

    .rail-pin-btn,
    .rail-tooltip {
      display: none;
    }
  }

  @media (hover: none), (pointer: coarse) {
    .rail-item:hover {
      transform: none;
    }

    .rail-pin-btn,
    .rail-tooltip {
      display: none;
    }
  }

  .rail-pin-divider {
    height: 1px;
    margin: 6px 8px;
    background: var(--border-light);
    opacity: 0.4;
  }

  .rail-item-wrapper.pinned .rail-item:not(:hover):not(.current) {
    background: rgba(245, 158, 11, 0.04);
  }

  .rail-pin-marker {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-faint);
    pointer-events: none;
  }

  .rail-pin-btn {
    position: absolute;
    top: 50%;
    right: -2px;
    transform: translate(100%, -50%);
    z-index: 4;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: var(--bg-surface);
    border: 0.5px solid var(--border-light);
    border-radius: 4px;
    color: var(--text-faint);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  }

  .rail-pin-btn:hover {
    color: var(--text);
    border-color: var(--text-faint);
    background: var(--border-light);
  }

  .rail-pin-btn:focus-visible {
    outline: 1px solid var(--text);
    outline-offset: 1px;
  }
</style>
