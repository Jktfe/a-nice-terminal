<!--
  RoomPlansPanel — renders plans attached to a room as donut cards.
  Reuses PlanDonutCard from /plans index for visual + behaviour parity:
  donut completion %, planId/title label, click-through to /plans/[planId].

  Read-only v1. Attach/detach happens via:
    - ant CLI:  ant plan attach-room <plan> <room>
    - API:      POST/DELETE /api/plans/:planId/rooms
  The empty state directs operators to the verb.
-->
<script lang="ts">
  import PlanDonutCard from './PlanDonutCard.svelte';

  type RoomPlanLink = {
    planId: string;
    attachedAtMs: number;
    attachedBy: string | null;
    completion: {
      planId: string;
      title: string | null;
      total: number;
      completed: number;
      pct: number;
    };
  };

  type Props = { plans: RoomPlanLink[]; plansFetchFailed?: boolean };
  let { plans, plansFetchFailed = false }: Props = $props();
</script>

{#if plansFetchFailed}
  <p class="empty" role="alert">
    Could not load plans for this room. Try refreshing in a moment.
  </p>
{:else if plans.length === 0}
  <p class="empty">
    No plans attached to this room yet.
    Use <code>ant plan attach-room &lt;plan_id&gt; &lt;room_id&gt;</code>
    to attach one — the donut + click-through will appear here.
  </p>
{:else}
  <div class="grid">
    {#each plans as p (p.planId)}
      <PlanDonutCard
        label={p.completion.title ?? p.planId}
        total={p.completion.total}
        completed={p.completion.completed}
        pct={p.completion.pct}
        href={`/plans/${encodeURIComponent(p.planId)}`}
      />
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid; gap: 0.6rem;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  }
  .empty {
    margin: 0; padding: 0.85rem 1rem; line-height: 1.5;
    border: 1px dashed var(--line-soft); border-radius: 0.7rem;
    color: var(--ink-soft); font-size: 0.88rem;
  }
  .empty code {
    padding: 0.05rem 0.35rem; border-radius: 0.3rem;
    background: var(--surface-raised); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.82rem;
  }
</style>
