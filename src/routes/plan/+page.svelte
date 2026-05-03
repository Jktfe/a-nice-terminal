<script lang="ts">
  import { goto } from '$app/navigation';
  import PlanView from '$lib/components/PlanView/PlanView.svelte';
  import { samplePlanEvents } from '$lib/components/PlanView/_fixture';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let mode: 'dark' | 'light' = $state('dark');

  const events = $derived(data.events.length ? data.events : samplePlanEvents);
  const isLive = $derived(data.source === 'live' && data.events.length > 0);
  const selectedPlanKey = $derived(
    data.session_id && data.plan_id ? `${data.session_id}::${data.plan_id}` : '',
  );
  const subtitle = $derived(
    isLive
      ? `Live run_events · ${data.plan_id} · ${data.events.length} events`
      : 'Sample plan fixture · waiting for live plan_* events',
  );

  function selectPlan(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) {
      goto('/plan');
      return;
    }
    const [sessionId, planId] = value.split('::');
    goto(`/plan?session_id=${encodeURIComponent(sessionId)}&plan_id=${encodeURIComponent(planId)}`);
  }
</script>

<svelte:head>
  <title>ANT · Plan</title>
</svelte:head>

<button
  class="mode-toggle"
  type="button"
  onclick={() => (mode = mode === 'dark' ? 'light' : 'dark')}
  aria-label="Toggle theme"
>{mode}</button>

<div class="plan-source" data-live={isLive}>
  <span class="plan-source-dot"></span>
  <span>{isLive ? 'Live' : 'Sample'}</span>
  {#if data.plans.length}
    <select aria-label="Select plan" value={selectedPlanKey} onchange={selectPlan}>
      {#each data.plans as plan}
        <option value={`${plan.session_id}::${plan.plan_id}`}>
          {plan.plan_id} · {plan.event_count}
        </option>
      {/each}
    </select>
  {/if}
</div>

<PlanView events={events} themeMode={mode} subtitle={subtitle} />

<style>
  .mode-toggle {
    position: fixed;
    top: 18px;
    right: 18px;
    z-index: 50;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(0, 0, 0, 0.04);
    color: inherit;
    border: 0.5px solid currentColor;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    opacity: 0.6;
  }
  .mode-toggle:hover { opacity: 1; }

  .plan-source {
    position: fixed;
    top: 18px;
    left: 18px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(460px, calc(100vw - 132px));
    min-height: 28px;
    padding: 4px 10px;
    border: 0.5px solid currentColor;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.04);
    color: inherit;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-transform: uppercase;
    opacity: 0.72;
  }
  .plan-source:hover,
  .plan-source:focus-within {
    opacity: 1;
  }
  .plan-source-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #ef4444;
    flex: 0 0 auto;
  }
  .plan-source[data-live='true'] .plan-source-dot {
    background: #34d399;
  }
  .plan-source select {
    min-width: 0;
    max-width: 320px;
    height: 20px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-transform: none;
    outline: none;
  }
  @media (max-width: 560px) {
    .plan-source {
      top: 54px;
      max-width: calc(100vw - 36px);
    }
    .plan-source select {
      max-width: 210px;
    }
  }
</style>
