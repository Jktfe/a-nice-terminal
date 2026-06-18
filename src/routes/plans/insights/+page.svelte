<!--
  /plans/insights — Lane-D cross-plan analytics dashboard. Thin shell
  around <PlansInsightsDashboard> + SimplePageShell; the dashboard
  component owns layout + empty states so this file stays small.
-->
<script lang="ts">
  import Explainable from '$lib/components/Explainable.svelte';
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

  {#if data.insightsFetchFailed}
    <section class="load-alert" role="alert" aria-live="polite">
      <strong>Insights did not load.</strong>
      <p>{data.insightsFetchMessage}</p>
    </section>
  {:else if !data.insights}
    <p class="empty">Insights endpoint unavailable. Try refreshing.</p>
  {:else}
    <Explainable explainKey="insights-dashboard">
      <PlansInsightsDashboard insights={data.insights} />
    </Explainable>
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
  .load-alert {
    margin: 1rem 0;
    padding: 0.9rem 1rem;
    border: 1px solid color-mix(in srgb, var(--danger, #c2410c) 45%, var(--line-soft));
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--danger, #c2410c) 8%, var(--paper));
    color: var(--ink-strong);
  }
  .load-alert strong {
    display: block;
    margin-bottom: 0.25rem;
  }
  .load-alert p {
    margin: 0;
    color: var(--ink-soft);
  }
  .empty {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    color: var(--ink-soft);
    border: 1px dashed var(--line-soft);
    border-radius: 0.6rem;
  }
</style>
