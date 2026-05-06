<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import PlanView from '$lib/components/PlanView/PlanView.svelte';
  import { samplePlanEvents } from '$lib/components/PlanView/_fixture';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let mode: 'dark' | 'light' = $state('light');

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

  onMount(() => {
    document.body.classList.add('plan-view-page');
    const html = document.documentElement;
    const previousTheme = html.getAttribute('data-theme');
    return () => {
      document.body.classList.remove('plan-view-page');
      if (previousTheme === null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', previousTheme);
    };
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (mode === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
  });
</script>

<svelte:head>
  <title>ANT · Plan</title>
</svelte:head>

<div class="mode-toggle" role="group" aria-label="Plan theme">
  <button
    type="button"
    class:active={mode === 'light'}
    aria-pressed={mode === 'light'}
    onclick={() => (mode = 'light')}
  >Light</button>
  <button
    type="button"
    class:active={mode === 'dark'}
    aria-pressed={mode === 'dark'}
    onclick={() => (mode = 'dark')}
  >Dark</button>
</div>

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
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.10);
    backdrop-filter: blur(12px);
  }
  .mode-toggle button {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    background: transparent;
    color: #4b5563;
    border: 0;
    border-radius: 6px;
    padding: 5px 9px;
    cursor: pointer;
    line-height: 1;
  }
  .mode-toggle button.active {
    background: #111827;
    color: #fff;
  }

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
    .mode-toggle {
      top: 12px;
      right: 12px;
    }
    .plan-source {
      top: 54px;
      max-width: calc(100vw - 36px);
    }
    .plan-source select {
      max-width: 210px;
    }
  }

  :global(body.plan-view-page) {
    overflow: auto;
  }
</style>
