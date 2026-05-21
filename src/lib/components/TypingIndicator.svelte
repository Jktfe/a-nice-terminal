<!--
  TypingIndicator — shows who is typing in the room above the composer.

  Owns two halves of the M19 typing surface:
    - Heartbeat POST: while the local user is typing, send a heartbeat to
      /api/chat-rooms/[roomId]/typing every 2 seconds so other members see
      this user as active.
    - Polling GET: regardless of local typing state, refresh the active
      typer list every 2 seconds so the strip stays current as other
      members start and stop.

  Renders nothing when there are no active typers other than the local
  user. The 5-second stale window lives in the server store; we just
  surface whatever the server returns.
-->
<script lang="ts">
  import type { ActiveTyper } from '$lib/server/typingIndicatorStore';

  type Props = {
    roomId: string;
    asHandle: string;
    isUserTyping: boolean;
  };

  let { roomId, asHandle, isUserTyping }: Props = $props();

  let activeTypers = $state<ActiveTyper[]>([]);

  async function fetchActiveTypers() {
    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/typing`);
      if (!response.ok) return;
      const body = (await response.json()) as { activeTypers?: ActiveTyper[] };
      activeTypers = body.activeTypers ?? [];
    } catch {
      // Soft-fail: the typing strip is decorative; never crash the composer.
    }
  }

  async function sendHeartbeat() {
    try {
      await fetch(`/api/chat-rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberHandle: asHandle })
      });
    } catch {
      // Soft-fail.
    }
  }

  // Polling raised from 2s → 15s. Previous cadence (30 fetches/min per
  // room) combined with read/reaction per-message pollers to crash tabs
  // on active rooms. SSE drives near-real-time anyway.
  $effect(() => {
    fetchActiveTypers();
    const pollInterval = setInterval(fetchActiveTypers, 15_000);
    return () => clearInterval(pollInterval);
  });

  $effect(() => {
    if (!isUserTyping) return;
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 15_000);
    return () => clearInterval(heartbeatInterval);
  });

  const typersOtherThanMe = $derived(
    activeTypers.filter((entry) => entry.memberHandle !== asHandle)
  );

  function describeTyperListAsText(typers: ActiveTyper[]): string {
    if (typers.length === 0) return '';
    if (typers.length === 1) return `${typers[0].memberHandle} is typing…`;
    if (typers.length === 2) {
      return `${typers[0].memberHandle} and ${typers[1].memberHandle} are typing…`;
    }
    return `${typers[0].memberHandle}, ${typers[1].memberHandle} and ${typers.length - 2} more are typing…`;
  }
</script>

{#if typersOtherThanMe.length > 0}
  <p class="typing-strip" role="status" aria-live="polite">
    <span class="typing-dot" aria-hidden="true"></span>
    {describeTyperListAsText(typersOtherThanMe)}
  </p>
{/if}

<style>
  .typing-strip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0.25rem 0.4rem;
    font-size: 0.78rem;
    color: var(--ink-soft);
    font-style: italic;
  }
  .typing-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--accent);
    animation: typing-pulse 1.2s ease-in-out infinite;
  }
  @keyframes typing-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
</style>
