<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AgentDot from '$lib/components/AgentDot.svelte';
  import { agentColorFromSession, NOCTURNE } from '$lib/nocturne';
  import { SESSIONS_CHANNEL } from '$lib/ws-channels';
  import type { AgentStatus } from '$lib/shared/agent-status';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string | null;
    display_name?: string | null;
    linked_chat_id?: string | null;
    cli_flag?: string | null;
    status?: string | null;
    ttl?: string | null;
    last_activity?: string | null;
  }

  interface StatusPayload {
    needs_input: boolean;
    event_class?: string;
    summary?: string;
    since?: string;
    agent_status?: AgentStatus;
  }

  const {
    session,
    allSessions,
    linkedChatId = '',
  }: {
    session: PageSession | null;
    allSessions: PageSession[];
    linkedChatId?: string;
  } = $props();

  let statusPayload = $state<StatusPayload>({ needs_input: false });
  let ws: WebSocket | null = null;
  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let loadedFor = $state<string | null>(null);

  const terminalId = $derived(session?.type === 'terminal' ? session.id : null);
  const linkedChat = $derived.by(() => {
    if (!session) return null;
    const id = linkedChatId || session.linked_chat_id;
    return id ? allSessions.find((s) => s.id === id) ?? null : null;
  });
  const agent = $derived(agentColorFromSession(session));
  const agentDotId = $derived(session?.cli_flag || session?.handle?.replace('@', '') || session?.name || 'terminal');
  const agentStatus = $derived(statusPayload.agent_status);

  const stateTone = $derived.by(() => {
    if (statusPayload.needs_input) return NOCTURNE.semantic.danger;
    switch (agentStatus?.state) {
      case 'ready': return NOCTURNE.emerald[400];
      case 'busy': return NOCTURNE.blue[400];
      case 'thinking': return NOCTURNE.amber[400];
      case 'error': return NOCTURNE.semantic.danger;
      case 'idle': return NOCTURNE.neutral[400];
      default: return agent.color;
    }
  });

  const stateLabel = $derived.by(() => {
    if (statusPayload.needs_input) return 'Needs input';
    switch (agentStatus?.state) {
      case 'ready': return 'Ready';
      case 'busy': return 'Busy';
      case 'thinking': return 'Thinking';
      case 'error': return 'Error';
      case 'idle': return 'Idle';
      default: return session?.status === 'active' ? 'Active' : 'Monitoring';
    }
  });

  const contextLabel = $derived.by(() => {
    if (agentStatus?.contextUsedPct != null) return `ctx ${agentStatus.contextUsedPct}% used`;
    if (agentStatus?.contextRemainingPct != null) return `ctx ${agentStatus.contextRemainingPct}% left`;
    return null;
  });

  const routeLabel = $derived.by(() => {
    if (!linkedChat) return 'Terminal only';
    return 'Private terminal input';
  });

  const detailLabel = $derived.by(() => {
    if (statusPayload.needs_input) return statusPayload.summary || 'Waiting for a response';
    if (agentStatus?.waitingFor) return agentStatus.waitingFor;
    if (agentStatus?.activity) return agentStatus.activity;
    if (agentStatus?.workspace && agentStatus?.branch) return `${agentStatus.workspace} · ${agentStatus.branch}`;
    if (agentStatus?.workspace) return agentStatus.workspace;
    return linkedChat ? `${linkedChat.name} -> ${session?.name}` : session?.name || '';
  });

  async function loadStatus(id: string) {
    try {
      const res = await fetch(`/api/sessions/${id}/status`);
      if (!res.ok) return;
      statusPayload = await res.json();
    } catch {
      // Status is advisory; leave the strip usable if polling fails.
    }
  }

  function connectWs() {
    if (destroyed || typeof window === 'undefined') return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'join_session', sessionId: SESSIONS_CHANNEL }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!terminalId || msg.sessionId !== terminalId) return;

        if (msg.type === 'agent_status_updated') {
          statusPayload = { ...statusPayload, agent_status: msg.status };
        } else if (msg.type === 'session_needs_input') {
          statusPayload = {
            ...statusPayload,
            needs_input: true,
            event_class: msg.eventClass,
            summary: msg.summary,
            since: new Date().toISOString(),
          };
        } else if (msg.type === 'session_input_resolved') {
          statusPayload = { ...statusPayload, needs_input: false, event_class: undefined, summary: undefined, since: undefined };
        }
      } catch {}
    };

    ws.onclose = () => {
      ws = null;
      if (!destroyed) reconnectTimer = setTimeout(connectWs, 3000);
    };
  }

  $effect(() => {
    if (!terminalId || terminalId === loadedFor) return;
    loadedFor = terminalId;
    statusPayload = { needs_input: false };
    void loadStatus(terminalId);
  });

  onMount(() => {
    connectWs();
  });

  onDestroy(() => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  });
</script>

{#if session?.type === 'terminal'}
  <div
    class="terminal-context"
    style="
      --agent-color: {agent.color};
      --state-color: {stateTone};
    "
  >
    <div class="terminal-context__identity">
      <div class="terminal-context__dot">
        <AgentDot
          id={agentDotId}
          size={14}
          state={statusPayload.needs_input
            ? 'thinking'
            : (agentStatus?.state === 'ready' || agentStatus?.state === 'busy' || agentStatus?.state === 'thinking')
              ? 'active'
              : 'idle'}
          ring={false}
        />
      </div>
      <div class="terminal-context__titles">
        <div class="terminal-context__name">
          <span>{session.display_name || session.name}</span>
          {#if session.handle}
            <span class="terminal-context__handle">{session.handle}</span>
          {/if}
        </div>
        <div class="terminal-context__route">
          <span>{routeLabel}</span>
          {#if linkedChat}
            <span class="terminal-context__separator">/</span>
            <span>{linkedChat.name}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="terminal-context__status">
      <span class="terminal-context__pill terminal-context__pill--state">
        <span class="terminal-context__pulse"></span>
        {stateLabel}
      </span>
      {#if agentStatus?.model}
        <span class="terminal-context__pill">{agentStatus.model}</span>
      {/if}
      {#if contextLabel}
        <span class="terminal-context__pill">{contextLabel}</span>
      {/if}
      {#if agentStatus?.rateLimitPct != null}
        <span class="terminal-context__pill">limit {agentStatus.rateLimitPct}%</span>
      {/if}
      {#if detailLabel}
        <span class="terminal-context__detail" title={detailLabel}>{detailLabel}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .terminal-context {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-light);
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--agent-color) 9%, transparent), transparent 45%),
      var(--bg-surface);
    min-height: 48px;
  }

  .terminal-context__identity {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .terminal-context__dot {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--agent-color) 12%, transparent);
    border: 0.5px solid color-mix(in srgb, var(--agent-color) 28%, var(--border-light));
  }

  .terminal-context__titles {
    min-width: 0;
  }

  .terminal-context__name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--text);
  }

  .terminal-context__name > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-context__handle,
  .terminal-context__route,
  .terminal-context__pill,
  .terminal-context__detail {
    font-family: var(--font-mono);
  }

  .terminal-context__handle {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--agent-color);
  }

  .terminal-context__route {
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 10px;
    color: var(--text-faint);
  }

  .terminal-context__route span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-context__separator {
    color: var(--border-subtle);
  }

  .terminal-context__status {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .terminal-context__pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    padding: 3px 7px;
    border-radius: var(--radius-full);
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-card);
    border: 0.5px solid var(--border-subtle);
  }

  .terminal-context__pill--state {
    color: var(--state-color);
    background: color-mix(in srgb, var(--state-color) 10%, transparent);
    border-color: color-mix(in srgb, var(--state-color) 30%, var(--border-subtle));
    font-weight: 700;
  }

  .terminal-context__pulse {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--state-color);
    box-shadow: 0 0 8px color-mix(in srgb, var(--state-color) 55%, transparent);
  }

  .terminal-context__detail {
    min-width: 90px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: var(--text-muted);
    text-align: right;
  }

  @media (max-width: 760px) {
    .terminal-context {
      align-items: stretch;
      flex-direction: column;
      gap: 7px;
      padding: 8px 10px;
    }

    .terminal-context__status {
      justify-content: flex-start;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .terminal-context__status::-webkit-scrollbar {
      display: none;
    }

    .terminal-context__detail {
      max-width: 220px;
      text-align: left;
    }
  }
</style>
