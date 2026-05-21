<!--
  PlanCockpitUnphased — split out of PlanCockpit.svelte to keep the parent
  under the 600-line cap (scripts/check-component-lines.mjs). #169 grouping
  lives here: split into Active (not finished) + Completed (collapsed) so
  operators see what's still open at-a-glance. Pure read-only render — all
  edits remain in the Gantt's TaskDetailPanel.
-->
<script lang="ts">
  import { normaliseSubject } from '$lib/tasks/normaliseSubject';

  type CockpitTask = {
    id: string;
    subject: string;
    status: string;
    priority: number | null;
    assignedAgent: string | null;
  };

  type Props = {
    unphasedTasks: CockpitTask[];
    onSelectTask?: (taskId: string) => void;
  };

  let { unphasedTasks, onSelectTask }: Props = $props();

  const FINISHED_STATUSES = new Set(['done', 'passing', 'completed']);
  function isFinished(status: string): boolean { return FINISHED_STATUSES.has(status); }
  function statusLabel(status: string): string {
    return status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const activeUnphased = $derived(unphasedTasks.filter((t) => !isFinished(t.status)));
  const finishedUnphased = $derived(unphasedTasks.filter((t) => isFinished(t.status)));
  let showFinishedUnphased = $state(false);
</script>

{#if unphasedTasks.length > 0}
  <section class="cockpit-section" aria-label="Unphased tasks">
    <h3>
      Unphased
      <span class="group-count">
        {activeUnphased.length} active · {finishedUnphased.length} done
      </span>
    </h3>

    {#if activeUnphased.length > 0}
      <h4 class="group-heading">Active</h4>
      <ul class="task-list">
        {#each activeUnphased.slice(0, 8) as task (`active:${task.id}`)}
          <li class="task-row">
            {#if onSelectTask}
              <button type="button" class="task-jump" onclick={() => onSelectTask?.(task.id)}>
                <span class="task-subject">{normaliseSubject(task.subject)}</span>
                <span class={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
                {#if task.priority !== null}<span class="task-priority">p{task.priority}</span>{/if}
              </button>
            {:else}
              <span class="task-subject">{normaliseSubject(task.subject)}</span>
              <span class={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if activeUnphased.length > 8}
        <p class="muted">+ {activeUnphased.length - 8} more active (open Gantt for the full list).</p>
      {/if}
    {:else if finishedUnphased.length > 0}
      <p class="muted">No active unphased tasks — only completed entries below.</p>
    {/if}

    {#if finishedUnphased.length > 0}
      <button
        type="button"
        class="group-toggle"
        aria-expanded={showFinishedUnphased}
        onclick={() => (showFinishedUnphased = !showFinishedUnphased)}
      >
        {showFinishedUnphased ? '▾' : '▸'} {finishedUnphased.length} completed
      </button>
      {#if showFinishedUnphased}
        <ul class="task-list task-list-faded">
          {#each finishedUnphased.slice(0, 12) as task (`done:${task.id}`)}
            <li class="task-row">
              {#if onSelectTask}
                <button type="button" class="task-jump" onclick={() => onSelectTask?.(task.id)}>
                  <span class="task-subject">{normaliseSubject(task.subject)}</span>
                  <span class={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
                </button>
              {:else}
                <span class="task-subject">{normaliseSubject(task.subject)}</span>
                <span class={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if finishedUnphased.length > 12}
          <p class="muted">+ {finishedUnphased.length - 12} more completed (open Gantt for the full list).</p>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .cockpit-section { display: flex; flex-direction: column; gap: 0.4rem; }
  .cockpit-section h3 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .task-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .task-row { font-size: 0.85rem; }
  .task-jump {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .task-jump:hover { border-color: var(--accent); }
  .task-subject { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-strong); }
  .task-status {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--surface-card);
    color: var(--ink-soft);
  }
  .task-status.status-in_progress { color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
  .task-status.status-completed { color: #16a34a; }
  .task-priority { font-size: 0.7rem; color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .muted { margin: 0; color: var(--ink-soft); font-size: 0.78rem; }
  .group-count {
    margin-left: 0.55rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .group-heading {
    margin: 0.55rem 0 0.35rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .group-toggle {
    margin: 0.55rem 0 0.35rem;
    padding: 0.25rem 0.65rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.45rem;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }
  .group-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .task-list-faded { opacity: 0.72; }
</style>
