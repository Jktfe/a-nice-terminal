<!--
  AgentTimeline — render an ordered list of agent events for a room.
  Backs M16 agent-timeline slice 1 (wireframe board W2Yo0T).

  Slice 1 ships flat-chronological rendering. Slice 2 will add group-by-agent
  with a tabs/filter strip once we have multi-agent traffic to display.

  Standalone — no edits to MessageList or +page.svelte. The room page will
  slot this beside MessageList in a follow-up slice.
-->
<script lang="ts">
  import type { AgentEvent } from '$lib/server/agentTimelineStore';
  import AgentTimelineRow from './AgentTimelineRow.svelte';

  type Props = {
    events: AgentEvent[];
    label?: string;
  };

  let { events, label = 'Agent activity' }: Props = $props();
</script>

<section class="agent-timeline" aria-label={label}>
  <header class="timeline-header">
    <span class="header-eyebrow">Agent activity</span>
    <span class="event-count">{events.length} event{events.length === 1 ? '' : 's'}</span>
  </header>

  {#if events.length === 0}
    <p class="empty-state">
      No agent events yet. Agents will post tool calls and status transitions
      here as they work.
    </p>
  {:else}
    <ol class="event-list">
      {#each events as event (event.id)}
        <li>
          <AgentTimelineRow {event} />
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .agent-timeline {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 1rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }

  .timeline-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .header-eyebrow {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
  }

  .event-count {
    font-size: 0.75rem;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .empty-state {
    margin: 0;
    padding: 0.85rem;
    text-align: center;
    color: var(--ink-soft);
    font-size: 0.88rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.8rem;
  }

  .event-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
</style>
