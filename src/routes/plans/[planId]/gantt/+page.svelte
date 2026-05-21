<!--
  /plans/[planId]/gantt — Integration full-shebang #1 svar-gantt Slice A
  + Slice B (drag-to-edit). Timeline view of a plan's tasks rendered
  via @svar-ui/svelte-gantt. Sibling to /plans/[planId] dashboard
  (which stays untouched).

  Slice A: render only.
  Slice B (this commit): drag task bars → PATCH /api/tasks/:id with
    { startedAtMs, endedAtMs }; optimistic update on drop; revert on 4xx/5xx.
    The svar-gantt component dispatches the `update-task` action both during
    drag (`inProgress: true`) and on drop (`inProgress` falsy). We only
    fire the PATCH on the final drop to avoid hammering the server, and
    we cache the previous bar position in case the PATCH fails so the UI
    can snap back.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Gantt, Willow } from '@svar-ui/svelte-gantt';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import {
    adaptPlanTasksToGantt,
    type AdaptedGantt,
    type GanttTask
  } from '$lib/gantt/planTaskAdapter';

  type Props = { data: { planId: string; planTitle: string | null } };
  let { data }: Props = $props();

  let adapted = $state<AdaptedGantt | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  // Toast-style notice surfaced under the chart when a PATCH succeeds /
  // fails. Cleared on the next successful drop.
  let dragNotice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function loadGantt(): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(data.planId)}/tasks`);
      if (!response.ok) {
        errorMessage = `Could not load plan tasks (${response.status}).`;
        return;
      }
      const body = (await response.json()) as { tasks?: unknown[] };
      adapted = adaptPlanTasksToGantt(body.tasks ?? []);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not load plan tasks.';
    } finally {
      loading = false;
    }
  }

  onMount(() => { void loadGantt(); });

  // Slice B: handle the svar-gantt `update-task` event. The event name
  // maps from the action `update-task` via the library's hyphen-strip
  // rule (see node_modules/@svar-ui/svelte-gantt/src/components/Gantt.svelte
  // — `"on" + a.replace(dash, "")`). Event payload shape (from
  // IDataMethodsConfig["update-task"]): { id, task: Partial<ITask>, inProgress?, ... }
  //
  // We snapshot the pre-drag start/end so an HTTP failure can revert
  // the optimistic move. The library mutates `tasks` in place via its
  // internal store; we mirror the change into our $state-bound array
  // so Svelte 5 re-renders the meta line + keeps the adapter source of
  // truth aligned.
  type UpdateTaskEvent = {
    id: string | number;
    task: Partial<GanttTask> & { start?: Date; end?: Date };
    inProgress?: boolean;
  };

  async function handleUpdateTask(ev: UpdateTaskEvent): Promise<void> {
    // Ignore intermediate drag frames — only PATCH on the final drop.
    if (ev.inProgress) return;
    if (!adapted) return;
    const taskId = String(ev.id);
    const current = adapted.tasks.find((t) => t.id === taskId);
    if (!current) return;
    const nextStart = ev.task.start instanceof Date ? ev.task.start : current.start;
    const nextEnd = ev.task.end instanceof Date ? ev.task.end : current.end;
    // No-op guard: drag may settle on the same position (e.g. click without
    // movement). Skip the PATCH in that case.
    if (nextStart.getTime() === current.start.getTime() && nextEnd.getTime() === current.end.getTime()) {
      return;
    }
    // Snapshot for revert on failure.
    const priorStart = current.start;
    const priorEnd = current.end;
    // Optimistic update — the library already moved its internal copy
    // of the bar; we update ours so the meta line + window derivation
    // stay in sync if the user keeps interacting.
    current.start = nextStart;
    current.end = nextEnd;
    dragNotice = null;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startedAtMs: nextStart.getTime(),
          endedAtMs: nextEnd.getTime()
        })
      });
      if (!response.ok) {
        // Revert the optimistic move; also reload to make sure the
        // svar-gantt internal store catches up with the server.
        current.start = priorStart;
        current.end = priorEnd;
        dragNotice = {
          kind: 'err',
          text: `Could not save move for “${current.text}” (${response.status}). Reverted.`
        };
        await loadGantt();
        return;
      }
      dragNotice = { kind: 'ok', text: `Saved “${current.text}” → ${formatRange(nextStart, nextEnd)}.` };
    } catch (cause) {
      current.start = priorStart;
      current.end = priorEnd;
      dragNotice = {
        kind: 'err',
        text: cause instanceof Error
          ? `Could not save move: ${cause.message}. Reverted.`
          : 'Could not save move. Reverted.'
      };
      await loadGantt();
    }
  }

  function formatRange(start: Date, end: Date): string {
    const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
    return `${start.toLocaleDateString(undefined, opts)} → ${end.toLocaleDateString(undefined, opts)}`;
  }
</script>

<svelte:head><title>{data.planTitle ?? data.planId} · Gantt | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Plans · Gantt"
  title={data.planTitle ?? data.planId}
  summary="Timeline of every task in this plan. Bar position = task start/end; colour = status; ‎mouse-over for details. Drag a bar to reschedule — saves automatically to the task's startedAtMs/endedAtMs."
>
  <nav class="gantt-subnav" aria-label="Plan secondary nav">
    <a class="subnav-link" href={`/plans/${encodeURIComponent(data.planId)}`}>← Dashboard</a>
    <a class="subnav-link active" href={`/plans/${encodeURIComponent(data.planId)}/gantt`}>Gantt</a>
    <a class="subnav-link" href="/plans">All plans →</a>
  </nav>

  {#if loading}
    <p class="gantt-status">Loading timeline…</p>
  {:else if errorMessage}
    <p class="gantt-error" role="alert">{errorMessage}</p>
  {:else if !adapted || adapted.tasks.length === 0}
    <p class="gantt-empty">No tasks in this plan yet. Add some via the <code>ant task create</code> CLI or the /plans/{data.planId} dashboard.</p>
  {:else}
    <p class="gantt-meta">
      <strong>{adapted.tasks.length}</strong> task{adapted.tasks.length === 1 ? '' : 's'} ·
      <strong>{adapted.links.length}</strong> dependenc{adapted.links.length === 1 ? 'y' : 'ies'} ·
      window {adapted.startLabel} → {adapted.endLabel}
    </p>
    <div class="gantt-frame">
      <Willow>
        <Gantt
          tasks={adapted.tasks}
          links={adapted.links}
          scales={[
            { unit: 'week', step: 1, format: "'w'w yyyy" },
            { unit: 'day', step: 1, format: 'd MMM' }
          ]}
          readonly={false}
          start={adapted.windowStart}
          end={adapted.windowEnd}
          onupdateTask={handleUpdateTask}
        />
      </Willow>
    </div>
    {#if dragNotice}
      <p class="gantt-notice" class:gantt-notice--ok={dragNotice.kind === 'ok'} class:gantt-notice--err={dragNotice.kind === 'err'} role="status">
        {dragNotice.text}
      </p>
    {/if}
    <p class="gantt-footnote">
      Slice B — drag a bar to reschedule. Releases <code>PATCH /api/tasks/&lt;id&gt;</code>
      with the new <code>startedAtMs</code>/<code>endedAtMs</code>; failures revert.
      Surface bars by status: green = done, amber = in_progress, grey = pending, red = blocked.
    </p>
  {/if}
</SimplePageShell>

<style>
  .gantt-subnav {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    margin: 0 0 1rem; padding: 0.55rem 0.85rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
  }
  .subnav-link {
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    text-decoration: none;
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 700;
    transition: color 0.12s, background-color 0.12s;
  }
  .subnav-link:hover { color: var(--ink-strong); background: var(--bg); }
  .subnav-link.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .gantt-status, .gantt-empty {
    margin: 0 0 1rem;
    color: var(--ink-soft);
    padding: 0.85rem 1rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.75rem;
    background: var(--bg);
  }
  .gantt-error {
    margin: 0 0 1rem;
    color: var(--warn, #c92020);
    font-weight: 700;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn, #c92020);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
  }
  .gantt-meta {
    margin: 0 0 0.7rem;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .gantt-meta strong { color: var(--ink-strong); }
  .gantt-frame {
    height: 70vh;
    min-height: 480px;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    overflow: hidden;
    background: var(--surface-card);
  }
  /* svar-gantt renders into a flex container; let it own its full height. */
  .gantt-frame :global(.wx-gantt) {
    height: 100% !important;
  }
  .gantt-notice {
    margin: 0.7rem 0 0;
    padding: 0.55rem 0.85rem;
    border-radius: 0.55rem;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .gantt-notice--ok {
    color: var(--ok, #0a7a3a);
    background: color-mix(in srgb, var(--ok, #0a7a3a) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--ok, #0a7a3a) 40%, transparent);
  }
  .gantt-notice--err {
    color: var(--warn, #c92020);
    background: color-mix(in srgb, var(--warn, #c92020) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn, #c92020) 40%, transparent);
  }
  .gantt-footnote {
    margin: 0.85rem 0 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-style: italic;
  }
</style>
