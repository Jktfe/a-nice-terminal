<!--
  AgentStatusFooter — Task #115 v3 footer parity.

  Always-visible compact strip showing each agent member's status so the
  user can tell at a glance who is working vs idle without opening the
  digest. Polls /api/chat-rooms/:roomId/agent-statuses every few seconds.
-->
<script lang="ts">
  import { subscribeToRoomEvents } from '$lib/stores/realtimeRoom.svelte';
  import AgentContextChip from './AgentContextChip.svelte';

  type AgentStatus = 'idle' | 'thinking' | 'working' | 'response-required' | 'unknown';
  type StatusEntry = {
    handle: string;
    status: AgentStatus;
    statusAtMs: number | null;
    // Optional context-window telemetry — added in the AgentContextChip
    // slice (JWPK msg_u7r6znc3ec). Codex's agent-statuses feed populates
    // these when available; chip hides itself when both are null.
    uptimeMs?: number | null;
    contextFill?: number | null;
  };

  type Props = {
    roomId: string;
    pollIntervalMs?: number;
  };

  let { roomId, pollIntervalMs = 30_000 }: Props = $props();

  const STATUS_LABEL: Record<AgentStatus, string> = {
    idle: 'idle',
    thinking: 'thinking',
    working: 'working',
    'response-required': 'needs reply',
    unknown: '—'
  };

  let statuses = $state<StatusEntry[]>([]);
  let lastFetchFailed = $state(false);

  async function refreshFromServer() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/agent-statuses`);
      if (!response.ok) throw new Error(`Could not fetch (${response.status}).`);
      const body = (await response.json()) as { statuses: StatusEntry[] };
      statuses = body.statuses ?? [];
      lastFetchFailed = false;
    } catch {
      lastFetchFailed = true;
    }
  }

  $effect(() => {
    if (!roomId) return;
    void refreshFromServer();
    const handle = setInterval(refreshFromServer, pollIntervalMs);
    return () => clearInterval(handle);
  });

  // #117 fix: subscribe to the room SSE stream and refresh as soon as the
  // server emits an agent_activity tick (or a message_added event, since
  // both signal that someone just acted). Drops the perceived "everyone
  // is idle" lag that polling alone produces.
  // PATCH B: replaced the 750ms setInterval watcher with a reactive
  // $effect on handle.eventCount. Same outcome (refresh on relevant SSE
  // events) without a perpetual busy-poll competing with the page-level
  // SSE-event-burst debounce.
  let handle = $state<ReturnType<typeof subscribeToRoomEvents> | null>(null);
  let lastSeenEventCount = $state(0);
  $effect(() => {
    if (!roomId) return;
    const h = subscribeToRoomEvents(roomId);
    handle = h;
    lastSeenEventCount = 0;
    return () => {
      h.close();
      handle = null;
    };
  });
  $effect(() => {
    const count = handle?.eventCount ?? 0;
    if (count <= lastSeenEventCount) return;
    lastSeenEventCount = count;
    const event = handle?.lastEvent;
    if (!event) return;
    if (event.type === 'agent_activity' || event.type === 'message_added') {
      void refreshFromServer();
    }
  });
</script>

{#if statuses.length > 0}
  <aside class="agent-status-footer" aria-label="Agent statuses">
    {#each statuses as entry (entry.handle)}
      <span class={`status-chip status-${entry.status}`} title={`${entry.handle}: ${STATUS_LABEL[entry.status]}`}>
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-handle">{entry.handle}</span>
        <span class="status-label">{STATUS_LABEL[entry.status]}</span>
        <AgentContextChip uptimeMs={entry.uptimeMs ?? null} contextFill={entry.contextFill ?? null} compact />
      </span>
    {/each}
    {#if lastFetchFailed}
      <span class="status-stale" role="status">offline</span>
    {/if}
  </aside>
{/if}

<style>
  .agent-status-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border-top: 1px solid var(--surface-edge);
    background: var(--surface);
    font-size: 0.75rem;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', monospace;
  }
  .status-dot {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--ink-soft);
    flex-shrink: 0;
  }
  .status-chip.status-idle .status-dot { background: #9ca3af; }
  .status-chip.status-thinking .status-dot {
    background: #f59e0b;
    animation: status-thinking-pulse 1.4s ease-in-out infinite;
  }
  .status-chip.status-working .status-dot {
    background: #16a34a;
    animation: status-working-pulse 1.8s ease-in-out infinite;
  }
  .status-chip.status-response-required .status-dot {
    background: #dc2626;
    animation: status-attention-pulse 1s ease-in-out infinite;
  }
  .status-chip.status-unknown { opacity: 0.55; }
  /* Subtle radial pulses so the eye picks up state without a label
     read. Thinking/working get a gentle amber/green halo cycle;
     response-required is faster + larger so it actually pulls focus
     away from the rest of the footer. Reduced-motion users get the
     static halos only. */
  @keyframes status-thinking-pulse {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 30%, transparent); }
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, #f59e0b 0%, transparent); }
  }
  @keyframes status-working-pulse {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, #16a34a 30%, transparent); }
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, #16a34a 0%, transparent); }
  }
  @keyframes status-attention-pulse {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, #dc2626 40%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, #dc2626 0%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-chip.status-thinking .status-dot,
    .status-chip.status-working .status-dot,
    .status-chip.status-response-required .status-dot {
      animation: none;
    }
    .status-chip.status-thinking .status-dot { box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 30%, transparent); }
    .status-chip.status-working .status-dot { box-shadow: 0 0 0 2px color-mix(in srgb, #16a34a 30%, transparent); }
    .status-chip.status-response-required .status-dot { box-shadow: 0 0 0 2px color-mix(in srgb, #dc2626 40%, transparent); }
  }
  .status-handle { font-weight: 700; }
  .status-label { color: var(--ink-soft); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .status-stale {
    margin-left: auto;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    border: 1px dashed var(--surface-edge);
    color: var(--ink-soft);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
