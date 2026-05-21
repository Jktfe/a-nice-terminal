<script lang="ts">
  import type { SessionTracker } from '$lib/domain/types';

  type Props = {
    sessionTracker: SessionTracker;
  };

  let { sessionTracker }: Props = $props();
</script>

<section class="platform-panel" aria-label="Session tracker">
  <div class="platform-panel-heading">
    <p>{sessionTracker.codename}</p>
    <strong>{sessionTracker.escalationsWaiting} flags</strong>
  </div>
  <div class="tracker-grid">
    <span>{sessionTracker.watchingRoomCount} rooms watched</span>
    <span>{sessionTracker.agentModel.costTier} model</span>
    <span>{sessionTracker.tokenBudgetPerDay.toLocaleString()} token/day cap</span>
    <span>Next sweep {sessionTracker.nextSweep}</span>
  </div>
</section>

<style>
  .tracker-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }

  .tracker-grid span {
    padding: 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    color: var(--ink-soft);
    background: var(--surface-card);
    font-weight: 850;
  }

  @media (max-width: 720px) {
    .tracker-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
