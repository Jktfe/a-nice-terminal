<!--
  DashboardSection — reusable section shell for the Dashboard overview
  page (PATH-IA-B per dashboard-ia-design-contract-2026-05-14). Renders
  an eyebrow + title row with an optional "view all" link, then the
  body slot.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    eyebrow?: string;
    viewAllHref?: string;
    viewAllLabel?: string;
    children?: Snippet;
  };

  let { title, eyebrow, viewAllHref, viewAllLabel = 'View all', children }: Props = $props();
</script>

<section class="dashboard-section">
  <header>
    <div>
      {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
      <h2>{title}</h2>
    </div>
    {#if viewAllHref}
      <a class="view-all" href={viewAllHref}>{viewAllLabel} →</a>
    {/if}
  </header>
  {@render children?.()}
</section>

<style>
  .dashboard-section {
    margin-top: 1.75rem;
    padding: 1.25rem;
    border-radius: 1.2rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    box-shadow: var(--shadow-card);
  }
  header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }
  .eyebrow {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.74rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  h2 { margin: 0.15rem 0 0; font-size: 1.35rem; }
  .view-all {
    color: var(--accent);
    font-weight: 800;
    font-size: 0.88rem;
    text-decoration: none;
  }
  .view-all:hover { text-decoration: underline; }
</style>
