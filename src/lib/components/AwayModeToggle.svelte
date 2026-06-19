<!--
  AwayModeToggle — visible buttons for active / away-desk / away-office / away-phone.
  JWPK 2026-05-23 (msg_fuvbzkd4wx, corrected voice-dictation reading):
  "Away from desk, brainstorming. Away from office should be deliveries."
  Canonical mapping per dictation + docs/contracts/room-state-away-mode-v1.md:
    active       → brainstorm  (default — agents respond freely)
    away-desk    → brainstorm  (open discussion, claims, no new direction)
    away-office  → heads-down  (claimed delivery only, page for blockers)
    away-phone   → heads-down  (long absence, bank decisions, urgent only)
  Earlier mapping (away-desk → heads-down, away-office → closed) was
  flagged by JWPK 2026-05-24 in yz4clwzvbm as not matching the dictation.
  Two tiers share `brainstorm` room mode — the active vs away-desk
  difference is presence/notification posture, not chat semantics.
  Two tiers share `heads-down` room mode — the away-office vs away-phone
  difference is expected contactability and token-burn posture.

  Persistence shape (per @speedycodex CHANGES REQUESTED 2026-05-24,
  orsz2321qb msg_ul0qt6x80m): tier is server-side state in away_modes
  table, scoped by handle. Toggle takes `currentTier` as a prop from
  the parent page (which fetched /api/away-modes/${callerHandle}) and
  on click PUTs the new tier to that endpoint in parallel with the
  room-mode PUT. Agents read via getAwayMode() so behaviour shifts
  while JWPK is away — localStorage couldn't do that.
-->
<script lang="ts">
  import type { RoomMode } from '$lib/server/roomModesStore';
  import type { AwayTier } from '$lib/server/awayModeStore';

  type Props = {
    roomId: string;
    currentMode: RoomMode;
    currentTier: AwayTier;
    callerHandle: string;
    loadError?: string | null;
    onModeChange?: (mode: RoomMode) => void;
    onTierChange?: (tier: AwayTier) => void;
  };

  let { roomId, currentMode, currentTier, callerHandle, loadError = null, onModeChange, onTierChange }: Props = $props();

  // Descriptions align with the server-side awayModeStore contract.
  // (JWPK flagged ad-hoc wording in yz4clwzvbm msg_jj50zw48fr — canonical text
  // must stay shared, not made up here).
  const STATES: { id: AwayTier; label: string; roomMode: RoomMode; hint: string; description: string }[] = [
    { id: 'active',      label: 'Working',          roomMode: 'brainstorm', hint: 'Working — present and engaged',            description: 'Shape ideas, challenge assumptions, compare options.' },
    { id: 'away-desk',   label: 'Away from desk',   roomMode: 'brainstorm', hint: 'Away from desk — mobile or short break',   description: 'User is mobile or temporarily unavailable.' },
    { id: 'away-office', label: 'Away from office', roomMode: 'heads-down', hint: 'Away from office — several hours away',    description: 'User unavailable for several hours.' },
    { id: 'away-phone',  label: 'Away from phone',  roomMode: 'heads-down', hint: 'Away from phone — long absence, urgent only', description: 'User is away from phone; bank decisions and avoid token burn.' }
  ];

  let switching = $state(false);
  let switchError = $state('');

  const activeState = $derived(STATES.find(s => s.id === currentTier) ?? STATES[0]);
  const visibleError = $derived(switchError || loadError || '');

  async function setState(state: typeof STATES[number]) {
    if (state.id === currentTier || switching) return;
    switching = true;
    switchError = '';
    try {
      // Fan out two PUTs in parallel:
      // 1. Room mode (per-room state visible to all members).
      // 2. Away tier (per-user state, observable to agents via getAwayMode).
      // Both must succeed for the UI to flip — if either fails we keep
      // the prior tier prop so the parent's invalidate() re-fetches truth.
      const [modeRes, tierRes] = await Promise.all([
        fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/mode`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: state.roomMode, pidChain: [] })
        }),
        fetch(`/api/away-modes/${encodeURIComponent(callerHandle)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier: state.id })
        })
      ]);
      if (modeRes.ok && tierRes.ok) {
        onModeChange?.(state.roomMode);
        onTierChange?.(state.id);
      } else {
        switchError = `Away mode update failed (room HTTP ${modeRes.status}, tier HTTP ${tierRes.status}).`;
      }
    } catch {
      switchError = 'Away mode update failed (network).';
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
        class:active={currentTier === s.id}
        class:switching
        aria-pressed={currentTier === s.id}
        title={s.hint}
        onclick={() => setState(s)}
        disabled={switching}
      >
        {s.label}
      </button>
    {/each}
  </div>
  {#if visibleError}
    <p class="away-mode-error" role="alert">{visibleError}</p>
  {/if}
</div>

<style>
  .away-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
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
  .away-mode-error {
    flex-basis: 100%;
    margin: 0;
    color: var(--danger, #b42318);
    font-size: 0.78rem;
    font-weight: 700;
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

  @media (max-width: 768px) {
    .away-mode-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.25rem;
      padding: 0;
      border-bottom: 0;
      background: transparent;
    }
    .away-mode-label {
      display: none;
    }
    .away-mode-toggle {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.25rem;
      overflow: visible;
      padding-bottom: 0;
    }
    .away-pill {
      min-height: 44px;
      width: 100%;
      padding: 0 0.3rem;
      font-size: 0.68rem;
      line-height: 1.05;
      white-space: normal;
    }
  }
</style>
