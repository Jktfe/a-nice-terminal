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

  const STATES: { id: AwayTier; label: string; roomMode: RoomMode; hint: string; description: string }[] = [
    { id: 'active',      label: 'Working',          roomMode: 'brainstorm', hint: 'Active — normal coordination', description: 'All agents respond freely' },
    { id: 'away-desk',   label: 'Away from desk',   roomMode: 'heads-down', hint: 'Away-desk — quiet work, claims only', description: 'Claims + targeted @mentions only' },
    { id: 'away-office', label: 'Away from office', roomMode: 'closed',    hint: 'Away-office — read-only, no new claims', description: 'Read-only. No new messages route.' }
  ];

  let switching = $state(false);

  function currentTier(): AwayTier {
    if (currentMode === 'heads-down') return 'away-desk';
    if (currentMode === 'closed') return 'away-office';
    return 'active';
  }

  const activeState = $derived(STATES.find(s => s.id === currentTier()) ?? STATES[0]);

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

<div class="away-mode-bar">
  <div class="away-mode-label" title={activeState.hint}>
    <span class="mode-indicator" class:heads-down={activeState.roomMode === 'heads-down'} class:closed={activeState.roomMode === 'closed'}></span>
    <strong>{activeState.label}</strong>
    <span class="mode-desc">{activeState.description}</span>
  </div>

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
</div>

<style>
  .away-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--line-soft, #ead8ca);
    background: var(--surface-raised, #fff0df);
  }
  .away-mode-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--ink-soft, #61564d);
  }
  .away-mode-label strong {
    color: var(--ink-strong, #181512);
    font-weight: 700;
  }
  .mode-indicator {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--ok, #1ac270);
  }
  .mode-indicator.heads-down {
    background: var(--warn, #ffb100);
  }
  .mode-indicator.closed {
    background: var(--accent, #ff3d5a);
  }
  .mode-desc {
    font-size: 0.78rem;
    color: var(--ink-muted, #8a7a70);
    margin-left: 0.25rem;
  }
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
