<!--
  /plans — L1 plans-index (Lane-D S2). Donut card per active plan +
  "Unfiled" lane for standalone tasks. The URL toggle ?show=archived or
  ?show=deleted swaps to archived / soft-deleted plans (Unfiled hides —
  it's an active-work card). Footer sub-nav links to /plans/insights +
  /plans/evidence + /plans/proposals + /plans/triggers.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import PlanDonutCard from '$lib/components/PlanDonutCard.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const eyebrow = $derived(
    data.showDeleted ? 'Plans · Deleted'
      : data.showArchived ? 'Plans · Archived'
      : 'Plans'
  );
  const title = $derived(
    data.showDeleted ? 'Deleted.'
      : data.showArchived ? 'Archived.'
      : 'Plans.'
  );
  const summary = $derived(
    data.showDeleted
      ? 'Soft-deleted plans — hidden from active work but recoverable. Restore any with `ant plan restore <plan_id>`. SURFACE-SIZE-ONLY — never auto-purged.'
      : data.showArchived
        ? 'Plans you have archived — out of the active queue but recoverable. Unarchive any with `ant plan unarchive <plan_id>`.'
        : "Completion across every active plan. Each card is a plan's done/total task ratio — open one for its Gantt. Standalone tasks live in Unfiled."
  );
</script>

<svelte:head><title>{eyebrow.split(' · ')[1] ?? 'Plans'} | ANT vNext</title></svelte:head>

<SimplePageShell {eyebrow} {title} {summary}>
  <nav class="subnav" aria-label="Plans secondary nav">
    <a class="subnav-link" class:active={!data.showArchived && !data.showDeleted} href="/plans">Active</a>
    <a class="subnav-link" class:active={data.showArchived} href="/plans?show=archived">Archived</a>
    <a class="subnav-link" class:active={data.showDeleted} href="/plans?show=deleted">Deleted</a>
    <span class="subnav-sep" aria-hidden="true">·</span>
    <a class="subnav-link" href="/plans/insights">Insights →</a>
    <a class="subnav-link" href="/plans/evidence">Evidence →</a>
    <a class="subnav-link" href="/plans/proposals">Proposals →</a>
    <a class="subnav-link" href="/plans/triggers">Triggers →</a>
  </nav>

  {#if data.plans.length === 0 && data.unfiled.total === 0}
    <p class="empty">
      {#if data.showDeleted}
        No soft-deleted plans. Delete one with <code>ant plan delete &lt;plan_id&gt;</code>.
      {:else if data.showArchived}
        No archived plans yet. Archive one with <code>ant plan archive &lt;plan_id&gt;</code>.
      {:else}
        No tasks yet. Create tasks via the task API or the coordination CLI —
        plans appear here as soon as tasks link to them.
      {/if}
    </p>
  {:else}
    <div class="grid" class:dimmed={data.showDeleted}>
      {#each data.plans as p (p.planId)}
        <PlanDonutCard
          label={p.title ?? p.planId}
          total={p.total}
          completed={p.completed}
          pct={p.pct}
          href={`/plans/${encodeURIComponent(p.planId)}`}
          planId={p.planId}
          showHardDelete={data.showArchived || data.showDeleted}
        />
      {/each}
      {#if data.unfiled.total > 0}
        <PlanDonutCard
          label="Unfiled"
          total={data.unfiled.total}
          completed={data.unfiled.completed}
          pct={data.unfiled.total === 0 ? 0 : data.unfiled.completed / data.unfiled.total}
        />
      {/if}
    </div>
  {/if}
</SimplePageShell>

<style>
  .subnav {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    margin: 0 0 0.9rem; padding: 0.55rem 0.85rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.7rem; font-size: 0.86rem;
  }
  .subnav-link {
    padding: 0.25rem 0.6rem; border-radius: 999px;
    color: var(--ink-soft); text-decoration: none; font-weight: 700;
    transition: color 0.12s, background 0.12s;
  }
  .subnav-link:hover { color: var(--ink-strong); background: var(--surface-raised); }
  .subnav-link.active {
    background: var(--accent); color: var(--surface-card);
  }
  .subnav-sep { color: var(--ink-muted); padding: 0 0.2rem; }
  .grid {
    display: grid; gap: 0.75rem;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  }
  /* Deleted cards visually de-emphasised — present but obviously out-of-band. */
  .grid.dimmed { opacity: 0.78; }
  .empty {
    margin: 0; padding: 1rem 1.1rem; line-height: 1.5;
    border: 1px dashed var(--line-soft); border-radius: 0.85rem;
    background: var(--surface-card); color: var(--ink-soft);
  }
  .empty code {
    padding: 0.05rem 0.4rem; border-radius: 0.3rem;
    background: var(--surface-raised); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.82rem;
  }
</style>
