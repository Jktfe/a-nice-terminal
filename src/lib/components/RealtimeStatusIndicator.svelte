<!--
  RealtimeStatusIndicator — small status pill rendering the SSE
  connection state per the finish-layer contract (Silent heroes
  yz4clwzvbm 2026-05-23 / overnight brief 2026-05-24).

  Consumes a `RealtimeRoomStore` from `$lib/client/realtimeRoomStore.ts`
  and surfaces:
    - idle / connecting / connected / catching-up: progress-shaped UX
    - caught-up: green dot, terse "live" label, auto-fades after 2s
    - disconnected: amber dot + retry countdown
    - unreachable: red dot + "ANT server unreachable" + manual retry CTA

  Drop into any page that wants to show realtime status. Header pill
  shape; takes minimal space when caught-up so it doesn't shout at the
  user when everything's working.
-->
<script lang="ts">
  import type { RealtimeRoomStore } from '$lib/client/realtimeRoomStore';

  type Props = {
    store: RealtimeRoomStore;
    /** When true, manual retry button fires close → re-create flow (caller-supplied). */
    onManualRetry?: () => void;
  };

  let { store, onManualRetry }: Props = $props();

  const snapshot = $derived(store.value);
  const isLive = $derived(snapshot.state === 'caught-up' || snapshot.state === 'connected');
  const isWarning = $derived(snapshot.state === 'disconnected' || snapshot.state === 'catching-up');
  const isError = $derived(snapshot.state === 'unreachable');

  function formatRetry(ms: number | null): string {
    if (ms === null || ms <= 0) return 'retrying…';
    const s = Math.ceil(ms / 1000);
    return `retrying in ${s}s`;
  }

  function labelFor(state: typeof snapshot.state): string {
    switch (state) {
      case 'idle': return 'idle';
      case 'connecting': return 'connecting…';
      case 'connected': return 'connected';
      case 'catching-up': return `catching up (${snapshot.lastSeq}/${snapshot.latestSeq})`;
      case 'caught-up': return 'live';
      case 'disconnected': return formatRetry(snapshot.retryInMs);
      case 'unreachable': return 'ANT server unreachable';
      default: return state;
    }
  }
</script>

<div
  class="realtime-status"
  class:live={isLive}
  class:warning={isWarning}
  class:error={isError}
  aria-live="polite"
  aria-atomic="true"
>
  <span class="dot" aria-hidden="true"></span>
  <span class="label">{labelFor(snapshot.state)}</span>
  {#if isError && onManualRetry}
    <button type="button" class="retry-btn" onclick={onManualRetry}>Retry now</button>
  {/if}
</div>

<style>
  .realtime-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 2px 10px 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--line-soft, #d6d6d6);
    background: var(--surface, #fff);
    font: 600 0.74rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-muted, #94a3b8);
    flex-shrink: 0;
  }
  .realtime-status.live {
    border-color: rgba(34, 197, 94, 0.5);
    background: rgba(34, 197, 94, 0.06);
    color: rgb(21, 128, 61);
  }
  .realtime-status.live .dot { background: rgb(34, 197, 94); }
  .realtime-status.warning {
    border-color: rgba(245, 158, 11, 0.55);
    background: rgba(245, 158, 11, 0.07);
    color: rgb(180, 83, 9);
  }
  .realtime-status.warning .dot { background: rgb(245, 158, 11); }
  .realtime-status.error {
    border-color: rgba(220, 38, 38, 0.55);
    background: rgba(220, 38, 38, 0.07);
    color: rgb(185, 28, 28);
  }
  .realtime-status.error .dot { background: rgb(220, 38, 38); }
  .retry-btn {
    background: transparent;
    border: 1px solid rgba(220, 38, 38, 0.55);
    color: rgb(185, 28, 28);
    border-radius: 999px;
    padding: 1px 8px;
    font: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .retry-btn:hover {
    background: rgba(220, 38, 38, 0.1);
  }
</style>
