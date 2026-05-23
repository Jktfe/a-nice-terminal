<!--
  AwayModeToggle — visible buttons for away-desk / away-office / active.
  JWPK 2026-05-23: away modes change agent behaviour via room mode mapping.
  away-desk → heads-down, away-office → closed, active → brainstorm.
-->
<script lang="ts">
  import type { RoomMode } from '$lib/server/roomModesStore';
  import type { AwayTier } from '$lib/server/awayModeStore';

  type Props = {
    roomId: string;
    currentMode: RoomMode;
    onModeChange?: (mode: RoomMode) => void;
  };

  let { roomId, currentMode, onModeChange }: Props = $props();

  const STATES: { id: AwayTier; label: string; roomMode: RoomMode; hint: string }[] = [
    { id: 'active',      label: 'Working',       roomMode: 'brainstorm', hint: 'Active — normal coordination' },
    { id: 'away-desk',   label: 'Away from desk', roomMode: 'heads-down', hint: 'Away-desk — quiet work, claims only' },
    { id: 'away-office', label: 'Away from office', roomMode: 'closed',    hint: 'Away-office — read-only, no new claims' }
  ];

  let switching = $state(false);

  function currentTier(): AwayTier {
    if (currentMode === 'heads-down') return 'away-desk';
    if (currentMode === 'closed') return 'away-office';
    return 'active';
  }

  async function setState(state: typeof STATES[number]) {
    if (state.id === currentTier() || switching) return;
    switching = true;
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: state.roomMode, pidChain: [] })
      });
      if (response.ok) {
        onModeChange?.(state.roomMode);
      }
    } finally {
      switching = false;
    }
  }
</script>

<div class="away-mode-toggle" role="group" aria-label="Away mode">
  {#each STATES as s}
    <button
      type="button"
      class="away-pill"
      class:active={currentTier() === s.id}
      class:switching
      aria-pressed={currentTier() === s.id}
      title={s.hint}
      onclick={() => setState(s)}
      disabled={switching}
    >
      {s.label}
    </button>
  {/each}
</div>

<style>
  .away-mode-toggle {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .away-pill {
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
  .away-pill:hover:not(:disabled) {
    border-color: var(--accent, #ff3d5a);
    color: var(--accent, #ff3d5a);
  }
  .away-pill.active {
    border-color: var(--ok, #1ac270);
    background: var(--ok, #1ac270);
    color: #fff;
  }
  .away-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
