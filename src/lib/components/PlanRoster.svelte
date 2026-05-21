<!--
  PlanRoster — render the projected Plan Mode event set.
  Source contract: Plan Mode Contract §1 (kinds) + §2 (event shape) + §3
  (projection + render order). Identity-key derivation is server-side; this
  component renders what the server projected, no client reinterpretation.
-->
<script lang="ts">
  import type { PlanEvent } from '$lib/server/planModeStore';

  type Props = {
    planId: string;
    events: PlanEvent[];
    includeArchived: boolean;
  };

  let { planId, events, includeArchived }: Props = $props();

  const sectionEvents = $derived(events.filter((event) => event.kind === 'plan_section'));
  const milestoneEvents = $derived(events.filter((event) => event.kind === 'plan_milestone'));
  const decisionEvents = $derived(events.filter((event) => event.kind === 'plan_decision'));
  const acceptanceEvents = $derived(events.filter((event) => event.kind === 'plan_acceptance'));
  const testEvents = $derived(events.filter((event) => event.kind === 'plan_test'));

  function decisionsUnder(parentId: string): PlanEvent[] {
    return decisionEvents.filter((decision) => decision.parent_id === parentId);
  }

  function acceptancesUnder(milestoneId: string): PlanEvent[] {
    return acceptanceEvents.filter((acceptance) => acceptance.milestone_id === milestoneId);
  }

  function testsUnder(milestoneId: string): PlanEvent[] {
    return testEvents.filter((test) => test.milestone_id === milestoneId);
  }

  function statusSlug(status: string | undefined): string {
    if (!status) return '';
    return status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
</script>

<section class="plan-roster" aria-labelledby="planRosterHeading">
  <h2 id="planRosterHeading" class="visually-hidden">Plan {planId}</h2>

  {#if events.length === 0}
    <p class="empty-state" role="note">
      No events for this plan yet. Use <code>ant plan section {planId} --title "..."</code> or seed via the CLI to populate.
    </p>
  {/if}

  {#each sectionEvents as section}
    <article class="section-block">
      <header>
        <span class="kind-tag">section</span>
        <h3>{section.title}</h3>
        {#if section.body}<p class="body">{section.body}</p>{/if}
      </header>
      {#each decisionsUnder(section.id) as decision}
        <div class="decision-row">
          <span class="kind-tag">decision</span>
          <span class="row-title">{decision.title}</span>
          {#if decision.status}<span class={`status-pill status-${statusSlug(decision.status)}`}>{decision.status}</span>{/if}
        </div>
      {/each}
    </article>
  {/each}

  {#each milestoneEvents as milestone}
    <article class="milestone-block">
      <header>
        <span class="kind-tag">milestone</span>
        <h3>{milestone.title}</h3>
        {#if milestone.status}<span class={`status-pill status-${statusSlug(milestone.status)}`}>{milestone.status}</span>{/if}
        {#if milestone.owner}<span class="owner-pill">{milestone.owner}</span>{/if}
      </header>
      {#if milestone.body}<p class="body">{milestone.body}</p>{/if}

      {#each acceptancesUnder(milestone.milestone_id ?? '') as acceptance}
        <div class="acceptance-row">
          <span class="kind-tag">acceptance</span>
          <span class="row-title">{acceptance.title}</span>
        </div>
      {/each}

      {#each testsUnder(milestone.milestone_id ?? '') as test}
        <div class="test-row">
          <span class="kind-tag">test</span>
          <span class="row-title">{test.title}</span>
          {#if test.status}<span class={`status-pill status-${statusSlug(test.status)}`}>{test.status}</span>{/if}
        </div>
      {/each}
    </article>
  {/each}

  {#if includeArchived}
    <p class="archived-notice" role="note">Including archived events (toggle off by removing <code>?include_archived=true</code>).</p>
  {/if}
</section>

<style>
  .plan-roster {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 1.2rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .empty-state {
    margin: 0;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.6rem;
    color: var(--ink-strong);
    background: var(--bg);
  }
  article {
    padding: 0.9rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.75rem;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .body {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .kind-tag {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border-radius: 0.4rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    color: var(--ink-soft);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
  }
  .row-title {
    font-weight: 700;
    color: var(--ink-strong);
  }
  .decision-row, .acceptance-row, .test-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.55rem;
    border-left: 2px solid var(--surface-edge);
    margin-left: 0.5rem;
  }
  .status-pill, .owner-pill {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 800;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
  }
  .status-pill.status-passing { background: rgba(0, 180, 90, 0.15); border-color: rgba(0, 180, 90, 0.45); }
  .status-pill.status-failing { background: rgba(220, 60, 60, 0.15); border-color: rgba(220, 60, 60, 0.45); }
  .status-pill.status-blocked { background: rgba(255, 165, 0, 0.18); border-color: rgba(255, 165, 0, 0.5); }
  .status-pill.status-done { background: rgba(0, 180, 90, 0.22); border-color: rgba(0, 180, 90, 0.55); }
  .status-pill.status-archived { opacity: 0.55; }
  .archived-notice {
    margin: 0;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    background: var(--surface);
    padding: 0.1rem 0.35rem;
    border-radius: 0.3rem;
  }
</style>
