<!--
  /plans/insights — Lane-D cross-plan analytics dashboard. Thin shell
  around <PlansInsightsDashboard> + SimplePageShell; the dashboard
  component owns layout + empty states so this file stays small.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import PlansInsightsDashboard from '$lib/components/PlansInsightsDashboard.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Plans · Insights | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Plans · Insights"
  title="Insights."
  summary="Across every plan and task — what shipped, what's stuck, where the work lives."
>
  <a class="back" href="/plans">← All plans</a>

  {#if !data.insights}
    <p class="empty">Insights endpoint unavailable. Try refreshing.</p>
  {:else}
    <PlansInsightsDashboard insights={data.insights} />
  {/if}
</SimplePageShell>

<style>
  .back {
    display: inline-block;
    margin: 0.5rem 0 1rem;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
  }
  .back:hover { color: var(--ink-strong); }
  .empty {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    color: var(--ink-soft);
    border: 1px dashed var(--line-soft);
    border-radius: 0.6rem;
  }
</style>
