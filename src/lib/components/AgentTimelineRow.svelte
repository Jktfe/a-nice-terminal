<!--
  AgentTimelineRow — render one agent event as a row.
  Backs M16 agent-timeline slice 1 (wireframe board W2Yo0T).

  Five event kinds rendered with colour-coded badges:
    - tool-call          blue
    - status-transition  grey
    - plan-mode-entered  amber
    - plan-mode-exited   amber
    - ask-user-question  info-blue
-->
<script lang="ts">
  import type { AgentEvent, AgentEventKind } from '$lib/server/agentTimelineStore';

  type Props = {
    event: AgentEvent;
  };

  let { event }: Props = $props();

  function describeKind(kind: AgentEventKind): string {
    switch (kind) {
      case 'tool-call':
        return 'tool call';
      case 'status-transition':
        return 'status';
      case 'plan-mode-entered':
        return 'plan mode';
      case 'plan-mode-exited':
        return 'plan resolved';
      case 'ask-user-question':
        return 'question';
    }
  }

  function describeMomentFromIso(isoTimestamp: string): string {
    try {
      return new Date(isoTimestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  }
</script>

<article class={`timeline-row kind-${event.kind}`}>
  <header>
    <span class="author-handle">{event.authorDisplayName}</span>
    <span class={`kind-badge kind-${event.kind}`}>{describeKind(event.kind)}</span>
    <span class="recorded-at">{describeMomentFromIso(event.recordedAt)}</span>
  </header>
  <p class="event-summary">{event.summary}</p>
</article>

<style>
  .timeline-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.55rem 0.8rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    border-left-width: 3px;
  }

  .timeline-row.kind-tool-call {
    border-left-color: var(--info);
  }

  .timeline-row.kind-status-transition {
    border-left-color: var(--ink-soft);
  }

  .timeline-row.kind-plan-mode-entered,
  .timeline-row.kind-plan-mode-exited {
    border-left-color: var(--warn);
  }

  .timeline-row.kind-ask-user-question {
    border-left-color: var(--accent);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.78rem;
  }

  .author-handle {
    font-weight: 800;
    color: var(--ink-strong);
  }

  .kind-badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 800;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
  }

  .kind-badge.kind-tool-call {
    background: color-mix(in srgb, var(--info) 18%, var(--surface));
    color: var(--info);
  }

  .kind-badge.kind-status-transition {
    background: color-mix(in srgb, var(--ink-soft) 18%, var(--surface));
    color: var(--ink-soft);
  }

  .kind-badge.kind-plan-mode-entered,
  .kind-badge.kind-plan-mode-exited {
    background: color-mix(in srgb, var(--warn) 18%, var(--surface));
    color: var(--warn);
  }

  .kind-badge.kind-ask-user-question {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
    color: var(--accent);
  }

  .recorded-at {
    margin-left: auto;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .event-summary {
    margin: 0;
    color: var(--ink-strong);
    line-height: 1.4;
  }
</style>
