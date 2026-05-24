<!--
  RoomPlanProgressBadge — compact inline progress for a room card.
  Shows a thin bar + percentage when planProgress is present.
  Mirrors the aggregate shape from /api/chat-rooms/plan-progress.
-->
<script lang="ts">
  type Props = {
    progress: { total: number; completed: number; pct: number } | null | undefined;
  };
  let { progress }: Props = $props();
</script>

{#if progress && progress.total > 0}
  <span class="progress-badge" title="{progress.completed}/{progress.total} tasks done">
    <span class="progress-bar" aria-hidden="true">
      <span class="progress-fill" style="width: {Math.round(progress.pct * 100)}%"></span>
    </span>
    <span class="progress-label">{Math.round(progress.pct * 100)}%</span>
  </span>
{/if}

<style>
  .progress-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .progress-bar {
    display: inline-block;
    width: 2.5rem;
    height: 0.35rem;
    background: var(--line-soft);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.2s ease;
  }
  .progress-label {
    font-variant-numeric: tabular-nums;
  }
</style>
