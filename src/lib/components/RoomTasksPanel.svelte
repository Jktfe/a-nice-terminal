<!--
  RoomTasksPanel — read-only task list for the room info dropdown (#54).
  Shows standalone tasks + plan-linked tasks. No write flows.
-->
<script lang="ts">
  import type { TaskForRoom } from '$lib/server/taskStore';
  import ValidationBadge from './ValidationBadge.svelte';

  type Props = { tasks: TaskForRoom[] };
  let { tasks }: Props = $props();

  // JWPK msg_uz34yby2qc (2026-05-19): "tasks need to drop off once complete -
  // this room alone does not have 312 open tasks". Filter out terminal-state
  // tasks (completed/cancelled) so the panel reflects ACTIONABLE work only.
  // Store still has them — just hidden from the room panel.
    function isValidationTask(t: TaskForRoom): boolean {
    return t.description?.includes('Validate claim') ?? false;
  }
  function extractClaimId(t: TaskForRoom): string | null {
    const m = t.description?.match(/Validate claim `([^`]+)`/);
    return m?.[1] ?? null;
  }
  const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);
  const activeTasks = $derived(tasks.filter((t) => !TERMINAL_STATUSES.has(t.status)));
  const standaloneTasks = $derived(activeTasks.filter((t) => t.planId == null));
  const planLinkedTasks = $derived(activeTasks.filter((t) => t.planId != null));
  const groupedByPlan = $derived.by(() => {
    const map = new Map<string, { label: string; tasks: TaskForRoom[] }>();
    for (const t of planLinkedTasks) {
      const key = t.planTitle ?? t.planId ?? 'Unknown plan';
      const group = map.get(key) ?? { label: key, tasks: [] };
      group.tasks.push(t);
      map.set(key, group);
    }
    return Array.from(map.values());
  });
</script>

{#if tasks.length === 0}
  <p class="empty">No tasks in this room yet.</p>
{:else}
  <div class="task-list">
    {#if standaloneTasks.length > 0}
      <div class="group">
        <span class="group-label">Standalone</span>
        {#each standaloneTasks as t (t.id)}
          <div class="task-row">
            <span class="status status-{t.status}"></span>
            <span class="subject">{t.subject}</span>
            {#if isValidationTask(t)}
              {@const claimId = extractClaimId(t)}
              {#if claimId}
                <ValidationBadge taskId={t.id} compact />
              {/if}
            {/if}
            {#if t.assignedAgent}
              <span class="agent">{t.assignedAgent}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#each groupedByPlan as group (group.label)}
      <div class="group">
        <span class="group-label">{group.label}</span>
        {#each group.tasks as t (t.id)}
          <div class="task-row">
            <span class="status status-{t.status}"></span>
            <span class="subject">{t.subject}</span>
            {#if isValidationTask(t)}
              {@const claimId = extractClaimId(t)}
              {#if claimId}
                <ValidationBadge taskId={t.id} compact />
              {/if}
            {/if}
            {#if t.assignedAgent}
              <span class="agent">{t.assignedAgent}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .empty {
    margin: 0; padding: 0.85rem 1rem; line-height: 1.5;
    border: 1px dashed var(--line-soft); border-radius: 0.7rem;
    color: var(--ink-soft); font-size: 0.88rem;
  }
  .task-list {
    display: flex; flex-direction: column; gap: 0.6rem;
    padding: 0.3rem 0.5rem;
  }
  .group {
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .group-label {
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--ink-soft);
    padding: 0.15rem 0;
  }
  .task-row {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.5rem;
    background: var(--surface-raised);
    font-size: 0.86rem;
  }
  .status {
    width: 0.5rem; height: 0.5rem; border-radius: 999px;
    flex-shrink: 0;
  }
  .status-pending { background: var(--warn); }
  .status-in_progress { background: var(--accent); }
  .status-blocked { background: color-mix(in srgb, var(--warn) 60%, var(--accent) 40%); }
  .status-completed { background: var(--ok); }
  .subject {
    flex: 1 1 auto; color: var(--ink-strong);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .agent {
    font-size: 0.75rem; color: var(--ink-soft);
    background: var(--surface-card);
    padding: 0.1rem 0.4rem; border-radius: 0.3rem;
  }
</style>
