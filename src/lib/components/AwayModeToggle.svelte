<!--
  AwayModeToggle — visible buttons for active / away-desk / away-office.
  JWPK 2026-05-23 (msg_fuvbzkd4wx, corrected voice-dictation reading):
  "Away from desk, brainstorming. Away from office should be deliveries."
  Canonical mapping per dictation + docs/contracts/room-state-away-mode-v1.md:
    active       → brainstorm  (default — agents respond freely)
    away-desk    → brainstorm  (open discussion, claims, no new direction)
    away-office  → heads-down  (claimed delivery only, page for blockers)
  Earlier mapping (away-desk → heads-down, away-office → closed) was
  flagged by JWPK 2026-05-24 in yz4clwzvbm as not matching the dictation.
  Two tiers share `brainstorm` room mode — the active vs away-desk
  difference is presence/notification posture, not chat semantics.
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

  // Descriptions taken verbatim from docs/contracts/room-state-away-mode-v1.md
  // (JWPK flagged ad-hoc wording in yz4clwzvbm msg_jj50zw48fr — canonical text
  // lives in the contract, not made up here).
  const STATES: { id: AwayTier; label: string; roomMode: RoomMode; hint: string; description: string }[] = [
    { id: 'active',      label: 'Working',          roomMode: 'brainstorm', hint: 'Working — present and engaged',     description: 'Shape ideas, challenge assumptions, compare options.' },
    { id: 'away-desk',   label: 'Away from desk',   roomMode: 'brainstorm', hint: 'Away from desk — mobile or short break', description: 'User is mobile or temporarily unavailable.' },
    { id: 'away-office', label: 'Away from office', roomMode: 'heads-down', hint: 'Away from office — several hours away',  description: 'User unavailable for several hours.' }
  ];

  let switching = $state(false);

  // Persisted-tier source per @speedycodex CHANGES REQUESTED on 994a6a4:
  // since `active` and `away-desk` now BOTH map to room mode `brainstorm`,
  // the toggle can't distinguish them from currentMode alone — without a
  // separate tier source, clicking Away-from-desk → PUT brainstorm →
  // reload → snap back to Working. We persist the chosen tier in
  // localStorage per (room, user-context) so the pill stays selected
  // across reloads. Server-side cross-device sync via /api/away-modes
  // is a v2 follow-up — that endpoint needs auth that the deck-share
  // path doesn't have today.
  const TIER_STORAGE_KEY = $derived(`antRoomAwayTier:${roomId}`);

  let storedTier = $state<AwayTier | null>(null);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(TIER_STORAGE_KEY);
    if (raw === 'active' || raw === 'away-desk' || raw === 'away-office') {
      storedTier = raw;
    }
  });

  function currentTier(): AwayTier {
    // 1. Honour the explicitly-stored tier if present (the user's chosen state).
    if (storedTier !== null) return storedTier;
    // 2. Fall back to a room-mode-derived guess when nothing's been chosen yet.
    //    Heads-down → away-office (the only tier that maps to heads-down).
    //    Closed → away-office as best-effort (no away-tier formally maps to closed).
    //    Brainstorm → active by default.
    if (currentMode === 'heads-down') return 'away-office';
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
        // Persist the chosen tier locally so the pill stays selected even
        // when active + away-desk share the same underlying room mode.
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(TIER_STORAGE_KEY, state.id);
        }
        storedTier = state.id;
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
