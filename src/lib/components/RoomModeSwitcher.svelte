<!--
  RoomModeSwitcher — visible mode indicator + switcher for brainstorm / heads-down / closed.
  JWPK 2026-05-23: room modes must be visible and switchable, not buried in data.
-->
<script lang="ts">
  import type { RoomMode } from '$lib/server/roomModesStore';

  type Props = {
    roomId: string;
    mode: RoomMode;
    onModeChange?: (mode: RoomMode) => void;
  };

  let { roomId, mode, onModeChange }: Props = $props();

  const MODES: { id: RoomMode; label: string; hint: string }[] = [
    { id: 'brainstorm', label: 'Brainstorm', hint: 'Open discussion, all agents respond' },
    { id: 'heads-down', label: 'Heads-down', hint: 'Quiet work, claims only' },
    { id: 'closed',     label: 'Closed',     hint: 'Read-only, no new claims' }
  ];

  let switching = $state(false);

  async function setMode(next: RoomMode) {
    if (next === mode || switching) return;
    switching = true;
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: next, pidChain: [] })
      });
      if (response.ok) {
        onModeChange?.(next);
      }
    } finally {
      switching = false;
    }
  }
</script>

<div class="room-mode-switcher" role="group" aria-label="Room mode">
  {#each MODES as m}
    <button
      type="button"
      class="mode-pill"
      class:active={mode === m.id}
      class:switching
      aria-pressed={mode === m.id}
      title={m.hint}
      onclick={() => setMode(m.id)}
      disabled={switching}
    >
      {m.label}
    </button>
  {/each}
</div>

<style>
  .room-mode-switcher {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .mode-pill {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line-soft, #ead8ca);
    border-radius: 999px;
    background: var(--surface-card, #ffffff);
    color: var(--ink-soft, #61564d);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .mode-pill:hover:not(:disabled) {
    border-color: var(--accent, #ff3d5a);
    color: var(--accent, #ff3d5a);
  }
  .mode-pill.active {
    border-color: var(--accent, #ff3d5a);
    background: var(--accent, #ff3d5a);
    color: #fff;
  }
  .mode-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .room-mode-switcher {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: max-content;
      gap: 0.45rem;
      max-width: 100%;
      overflow-x: auto;
      padding: 0.2rem 0 0.35rem;
      scroll-snap-type: x proximity;
      -webkit-overflow-scrolling: touch;
    }
    .room-mode-switcher::-webkit-scrollbar {
      display: none;
    }
    .mode-pill {
      min-height: 44px;
      padding: 0.55rem 0.85rem;
      font-size: 0.86rem;
      scroll-snap-align: start;
      white-space: nowrap;
    }
  }
</style>
