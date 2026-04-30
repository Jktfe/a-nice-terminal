<script lang="ts">
  import { goto } from '$app/navigation';
  import { NOCTURNE, agentColorFromSession } from '$lib/nocturne';
  import { SESSIONS_CHANNEL } from '$lib/ws-channels';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';
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
    last_activity?: string;
    updated_at?: string;
    linked_chat_id?: string | null;
    attention_state?: string | null;
    attention_reason?: string | null;
    focus_room_name?: string | null;
    focus_queue_count?: number | null;
    meta?: string | Record<string, unknown> | null;
  }

  let { currentSessionId }: { currentSessionId: string } = $props();

  let sessions = $state<RailSession[]>([]);
  let needsInputMap = $state(new Map<string, { eventClass: string; summary: string }>());
  let idleAttentionSet = $state(new Set<string>());
  let unreadSet = $state(new Set<string>());
  let hoveredId = $state<string | null>(null);
  let tooltipPos = $state<{ top: number; left: number } | null>(null);

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
      sessions = (data.sessions || []).filter((s: RailSession) => s.status !== 'archived');
    } catch {}
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
          const next = new Map(needsInputMap);
          next.set(msg.sessionId, { eventClass: msg.eventClass, summary: msg.summary });
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

  onMount(() => {
    loadSessions();
    connectWs();
  });

  onDestroy(() => {
    wsDestroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
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
  const needsAttentionTerminals = $derived(
    sessions.filter(s => s.type === 'terminal' && (needsInputMap.has(s.id) || s.attention_state === 'focus'))
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
    return result;
  });

  function agentId(s: RailSession): string | null {
    return s.cli_flag || s.handle?.replace('@', '') || null;
  }

  function sessionStatus(s: RailSession): 'active' | 'idle' {
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="activity-rail"
  style="
    --rail-bg: var(--bg-surface);
    --rail-border: var(--border-light);
  "
>
  <!-- Home button — back to dashboard -->
  <button
    class="rail-item rail-home"
    onclick={() => goto('/')}
    title="Dashboard"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  </button>

  <div class="rail-divider"></div>

  <!-- Session items -->
  <div class="rail-sessions">
    {#each orderedSessions as sess (sess.id)}
      {@const isCurrent = sess.id === currentSessionId}
      {@const agent = agentColorFromSession(sess)}
      {@const hasNeedsInput = needsInputMap.has(sess.id)}
      {@const hasIdleAttention = idleAttentionSet.has(sess.id)}
      {@const hasUnread = unreadSet.has(sess.id)}
      {@const hasFocus = sess.attention_state === 'focus'}
      {@const aid = agentId(sess)}
      {@const isHovered = hoveredId === sess.id}

      <div class="rail-item-wrapper">
        <button
          class="rail-item"
          class:current={isCurrent}
          onclick={() => navigateTo(navigationTarget(sess), sess.id)}
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
          title="{sess.display_name || sess.name}{sess.linked_chat_id ? ' — open linked chat' : ''}{hasNeedsInput ? ' — needs input' : ''}{hasFocus ? ' — focus mode' : ''}"
          style="
            --agent-color: {agent.color};
            --agent-glow: {agent.glow};
          "
        >
          <!-- Active indicator bar -->
          {#if isCurrent}
            <div class="rail-active-bar" style="background: {agent.color};"></div>
          {/if}

          <!-- Session dot -->
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

          <!-- Badges -->
          {#if hasNeedsInput}
            <div class="rail-badge rail-badge-urgent" title="Needs input — {needsInputMap.get(sess.id)?.summary ?? 'waiting for you'}"></div>
          {:else if hasFocus}
            <div class="rail-badge rail-badge-focus" title="Focus mode — {sess.focus_queue_count || 0} queued"></div>
          {:else if hasUnread && !isCurrent}
            <div class="rail-badge rail-badge-unread" title="Unread activity"></div>
          {:else if hasIdleAttention}
            <div class="rail-badge rail-badge-idle" title="Idle — no recent activity"></div>
          {/if}
        </button>

      </div>
    {/each}
  </div>

  <!-- Fixed tooltip (outside scroll container to avoid clipping) -->
  {#if hoveredId && tooltipPos}
    {@const sess = orderedSessions.find(s => s.id === hoveredId)}
    {#if sess}
      {@const agent = agentColorFromSession(sess)}
      {@const hasNeedsInput = needsInputMap.has(sess.id)}
      {@const hasFocus = sess.attention_state === 'focus'}
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
        {#if agentStatusMap.has(sess.id)}
          {@const telemetry = agentStatusMap.get(sess.id)}
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

<style>
  .activity-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 56px;
    height: 100%;
    background: var(--rail-bg);
    border-right: 1px solid var(--rail-border);
    padding: 8px 0;
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

  /* Hide on very small screens */
  @media (max-width: 640px) {
    .activity-rail {
      display: none;
    }
  }
</style>
