<!--
  /plans/triggers — ANTSCRIPT trigger management UI.

  Thin shell around <TriggerList> (read-only table) + <TriggerBuilder>
  (interactive CLI-command emitter). No in-browser POST — admin
  mutation stays at the `ant plan trigger` CLI tier so the admin bearer
  never enters the browser. Event/action option lists are read from
  $lib/server/planTriggerStore via +page.server.ts so new entries added
  by the sibling dispatcher slice are picked up automatically.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import TriggerList from '$lib/components/PlanTriggers/TriggerList.svelte';
  import TriggerBuilder from '$lib/components/PlanTriggers/TriggerBuilder.svelte';
  import type { PlanRecord } from '$lib/server/planStore';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const planById: Record<string, PlanRecord> = $derived(
    Object.fromEntries((data.plans ?? []).map((p) => [p.id, p]))
  );
</script>

<svelte:head><title>Plans · Triggers | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Plans · Triggers"
  title="Triggers."
  summary="Automate plan/task lifecycle events. Add triggers to post messages to attached rooms, log to console, hit webhooks, or create follow-up tasks. Mutation via the `ant plan trigger` CLI — this page builds the commands for you."
>
  <nav class="sub" aria-label="Plans sub-nav">
    <a class="back" href="/plans">← All plans</a>
    <span class="chips">
      <a href="/plans/insights">Insights</a>
      <a href="/plans/evidence">Evidence</a>
    </span>
  </nav>

  <section class="card" aria-label="Existing triggers">
    <header class="card-head">
      <h2>Existing triggers</h2>
      <span class="count">{data.triggers.length} total</span>
    </header>
    <TriggerList triggers={data.triggers} planById={planById} />
  </section>

  <section class="card" aria-label="Build a new trigger">
    <header class="card-head">
      <h2>Build a new trigger</h2>
    </header>
    <TriggerBuilder
      eventOptions={data.events ?? []}
      actionOptions={data.actions ?? []}
      plans={data.plans ?? []}
    />
  </section>
</SimplePageShell>

<style>
  nav.sub {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.6rem; margin: 0.5rem 0 1rem; flex-wrap: wrap;
  }
  .back { color: var(--ink-soft); text-decoration: none; font-weight: 700; }
  .back:hover { color: var(--ink-strong); }
  .chips { display: inline-flex; gap: 0.4rem; flex-wrap: wrap; }
  .chips a {
    padding: 0.35rem 0.75rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--surface-card);
    color: var(--ink-strong); text-decoration: none; font-weight: 700;
    font-size: 0.82rem;
  }
  .chips a:hover { border-color: var(--accent); color: var(--accent); }

  .card {
    margin: 1rem 0; padding: 1rem 1.1rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 1rem; box-shadow: var(--shadow-card);
  }
  .card-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 0.6rem; margin-bottom: 0.75rem;
  }
  .card-head h2 {
    margin: 0; font-size: 0.95rem; color: var(--ink-strong);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .count { color: var(--ink-soft); font-size: 0.8rem; }
</style>
