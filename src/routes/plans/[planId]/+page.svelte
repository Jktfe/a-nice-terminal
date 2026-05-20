<!--
  /plans/[planId] — L2 per-plan Gantt + L3 detail (Lane-D S2).
  Left: subject + priority (priority-sortable via the priority filter /
  server order). Middle: a bar per task — time-scaled across
  startedAtMs..endedAtMs when any task carries both, otherwise an
  equal-width sequence in the server's priority order. blocked_by is
  surfaced as a dependency chip that highlights its blocker rows on
  hover (v1 — literal curved SVG arrows are a deliberate follow-on, see
  slice note). Bar hover-tooltip = assigned agent. Right filter panel
  (priority + agent) is client-side. Clicking a task opens the L3 panel.
-->
<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import TaskDetailPanel from '$lib/components/TaskDetailPanel.svelte';
  import PlanRetrospective from '$lib/components/PlanRetrospective.svelte';
  import PlanCockpit from '$lib/components/PlanCockpit.svelte';
  import type { Task } from '$lib/server/taskStore';
  import { normaliseSubject } from '$lib/tasks/normaliseSubject';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // JWPK msg_z0ckdgazh6 ask-answer: "Cockpit is a verb we should be rid
  // of. It's dashboard". Default plan view = the dashboard tab (was
  // 'cockpit'); Gantt + Retrospective are additive sibling tabs.
  let view = $state<'dashboard' | 'gantt' | 'retro'>('dashboard');
  let filterPriority = $state<string>('all');
  let filterAgent = $state<string>('all');
  let selectedId = $state<string | null>($page.url.searchParams.get('task'));
  let hoverBlockers = $state<Set<string>>(new Set());

  const tasks = $derived(data.tasks as Task[]);
  // #171: surface the plan's friendly title in the page title + summary
  // instead of the URL slug. Fall back to the slug when the plan record
  // has no title, or when the lifecycle row was never created and we
  // only have the completion row's title.
  const friendlyPlanName = $derived(
    data.plan?.title ?? data.completion?.title ?? data.planId
  );
  const priorities = $derived(
    [...new Set(tasks.map((t) => (t.priority === null ? 'none' : String(t.priority))))].sort()
  );
  const agents = $derived(
    [...new Set(tasks.map((t) => t.assignedAgent).filter((a): a is string => !!a))].sort()
  );
  const filtered = $derived(
    tasks.filter((t) => {
      const pOk =
        filterPriority === 'all' ||
        (filterPriority === 'none' ? t.priority === null : String(t.priority) === filterPriority);
      const aOk = filterAgent === 'all' || t.assignedAgent === filterAgent;
      return pOk && aOk;
    })
  );

  // Time-scaled when at least one filtered task has a real span; else
  // equal-width sequence in the (already priority-ordered) list order.
  const timed = $derived(
    filtered.filter((t) => t.startedAtMs !== null && t.endedAtMs !== null)
  );
  const span = $derived.by(() => {
    if (timed.length === 0) return null;
    const min = Math.min(...timed.map((t) => t.startedAtMs as number));
    const max = Math.max(...timed.map((t) => t.endedAtMs as number));
    return max > min ? { min, max } : null;
  });

  function barStyle(t: Task, index: number): string {
    if (span && t.startedAtMs !== null && t.endedAtMs !== null) {
      const range = span.max - span.min;
      const left = ((t.startedAtMs - span.min) / range) * 100;
      const width = Math.max(2, ((t.endedAtMs - t.startedAtMs) / range) * 100);
      return `left:${left}%;width:${width}%`;
    }
    if (span) return 'left:0;width:100%;opacity:0.45'; // untimed in timed view
    const n = filtered.length || 1;
    return `left:${(index / n) * 100}%;width:${(1 / n) * 100}%`;
  }

  const selected = $derived(tasks.find((t) => t.id === selectedId) ?? null);

  function select(id: string): void {
    selectedId = id;
  }
  function blockerSubjects(t: Task): string {
    return t.blockedBy
      .map((id) => tasks.find((x) => x.id === id)?.subject ?? id)
      .join(', ');
  }
</script>

<svelte:head><title>{friendlyPlanName} · Plan | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Plan"
  title={view === 'dashboard' ? 'Dashboard.' : view === 'gantt' ? 'Gantt.' : 'Retrospective.'}
  summary={`${friendlyPlanName} — ${data.completion.completed}/${data.completion.total} tasks complete (${Math.round(data.completion.pct * 100)}%).`}
>
  <a class="back" href="/plans">← All plans</a>

  <!-- Lifecycle banner (plansStore). Renders ONLY when the plan record
       has archived_at_ms or deleted_at_ms set — implicit plans (no row)
       and active plans render no banner at all. Read-only display; the
       state-change verbs live in the CLI: `ant plan archive/restore/
       delete/restore-delete`. -->
  {#if data.plan && data.plan.deletedAtMs !== null}
    <p class="lifecycle-banner" data-state="deleted" role="status">
      <strong>Deleted</strong> · soft-deleted {new Date(data.plan.deletedAtMs).toLocaleString()}
      — recover with <code>ant plan restore-delete {data.planId}</code>
    </p>
  {:else if data.plan && data.plan.archivedAtMs !== null}
    <p class="lifecycle-banner" data-state="archived" role="status">
      <strong>Archived</strong> · {new Date(data.plan.archivedAtMs).toLocaleString()}
      — restore with <code>ant plan unarchive {data.planId}</code>
    </p>
  {/if}

  <!-- M:N plan↔rooms (planRoomLinkStore). Read-only chip strip v1:
       attach/detach is admin-bearer (CLI or direct API). Each chip
       links to the room. Empty state directs operators to the verb. -->
  <section class="rooms" aria-label="Rooms this plan is attached to">
    <span class="rooms-label">Rooms</span>
    {#if data.rooms.length === 0}
      <span class="rooms-empty">
        Not attached to any room yet.
        <a class="rooms-attach-btn" href={`/rooms?attachPlanId=${encodeURIComponent(data.planId)}`}>
          Attach a room
        </a>
      </span>
    {:else}
      <ul class="rooms-chips">
        {#each data.rooms as r (r.roomId)}
          <li>
            <a class="room-chip" href={`/rooms/${encodeURIComponent(r.roomId)}`}
               title={`Attached ${r.attachedBy ? 'by ' + r.attachedBy + ' ' : ''}at ${new Date(r.attachedAtMs).toLocaleString()}`}>
              {r.name}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="view-toggle" role="tablist" aria-label="Plan view">
    <button
      type="button"
      role="tab"
      aria-selected={view === 'dashboard'}
      class="vt-btn"
      class:active={view === 'dashboard'}
      onclick={() => (view = 'dashboard')}
    >Dashboard</button>
    <button
      type="button"
      role="tab"
      aria-selected={view === 'gantt'}
      class="vt-btn"
      class:active={view === 'gantt'}
      onclick={() => (view = 'gantt')}
    >Gantt</button>
    <button
      type="button"
      role="tab"
      aria-selected={view === 'retro'}
      class="vt-btn"
      class:active={view === 'retro'}
      onclick={() => (view = 'retro')}
    >Retrospective</button>
  </div>

  {#if view === 'dashboard'}
    <PlanCockpit
      planId={data.planId}
      onSelectTask={(taskId) => { selectedId = taskId; view = 'gantt'; }}
    />
  {:else if view === 'gantt'}
    <div class="filters">
      <label>Priority
        <select bind:value={filterPriority}>
          <option value="all">All</option>
          {#each priorities as p}<option value={p}>{p === 'none' ? 'No priority' : p}</option>{/each}
        </select>
      </label>
      <label>Agent
        <select bind:value={filterAgent}>
          <option value="all">All</option>
          {#each agents as a}<option value={a}>{a}</option>{/each}
        </select>
      </label>
      <span class="shown">{filtered.length} of {tasks.length} shown</span>
    </div>

    <div class="layout" class:has-detail={!!selected}>
      <div class="gantt">
        {#if filtered.length === 0}
          <p class="empty">No tasks match these filters.</p>
        {:else}
          {#each filtered as t, i (t.id)}
            <button
              type="button"
              class="row"
              class:sel={t.id === selectedId}
              class:hl={hoverBlockers.has(t.id)}
              onclick={() => select(t.id)}
            >
              <span class="left">
                <span class="subj" title={t.subject}>{normaliseSubject(t.subject)}</span>
                <span class="pri">{t.priority ?? '—'}</span>
              </span>
              <span class="lane">
                <span
                  class="bar"
                  data-status={t.status}
                  style={barStyle(t, i)}
                  title={t.assignedAgent ? `Agent: ${t.assignedAgent}` : 'Unassigned'}
                ></span>
                {#if t.blockedBy.length > 0}
                  <span
                    class="dep"
                    role="presentation"
                    title={`Blocked by: ${blockerSubjects(t)}`}
                    onmouseenter={() => (hoverBlockers = new Set(t.blockedBy))}
                    onmouseleave={() => (hoverBlockers = new Set())}
                  >⇠ {t.blockedBy.length}</span>
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      </div>

      {#if selected}
        <TaskDetailPanel
          task={selected}
          allTasks={tasks}
          onClose={() => (selectedId = null)}
          onMutated={() => void invalidateAll()}
        />
      {/if}
    </div>
  {:else}
    <PlanRetrospective
      planId={data.planId}
      completion={data.completion}
      tasks={tasks}
    />
  {/if}
</SimplePageShell>

<style>
  .back { display: inline-block; margin-bottom: 0.8rem; color: var(--accent-strong); text-decoration: none; }
  .lifecycle-banner {
    margin: 0 0 0.9rem; padding: 0.65rem 0.9rem; line-height: 1.45;
    border: 1px solid var(--line-soft); border-radius: 0.6rem;
    font-size: 0.86rem; color: var(--ink-strong);
  }
  .lifecycle-banner[data-state="archived"] {
    background: color-mix(in srgb, var(--warn) 16%, var(--surface-card));
    border-color: var(--warn);
  }
  .lifecycle-banner[data-state="deleted"] {
    background: color-mix(in srgb, var(--accent-strong) 14%, var(--surface-card));
    border-color: var(--accent-strong);
  }
  .lifecycle-banner code {
    padding: 0.05rem 0.4rem; border-radius: 0.3rem;
    background: var(--surface-raised); font-family: ui-monospace, monospace;
    font-size: 0.82rem;
  }
  .rooms {
    display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center;
    margin-bottom: 0.9rem; padding: 0.65rem 0.9rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
  }
  .rooms-label {
    font-size: 0.74rem; font-weight: 900; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--ink-soft);
  }
  .rooms-empty {
    display: inline-flex; align-items: center; gap: 0.55rem;
    color: var(--ink-muted); font-size: 0.82rem;
  }
  /* #167 — replaced the dev-jargon `POST /api/plans/X/rooms (admin)` blob
     with a friendly Attach-a-room link. The destination /rooms?attachPlanId=…
     is where the chooser flow lives once the rooms-index picks up that
     query param; for now it lands users in the right room-picker context. */
  .rooms-attach-btn {
    display: inline-flex; align-items: center;
    padding: 0.25rem 0.7rem; border-radius: 999px;
    border: 1px solid var(--accent); background: transparent;
    color: var(--accent); font-size: 0.82rem; font-weight: 800;
    text-decoration: none;
  }
  .rooms-attach-btn:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .rooms-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .room-chip {
    display: inline-flex; align-items: center;
    padding: 0.25rem 0.7rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--surface-raised);
    color: var(--ink-strong); font-size: 0.82rem; font-weight: 700;
    text-decoration: none;
  }
  .room-chip:hover { border-color: var(--accent); }
  .filters {
    display: flex; flex-wrap: wrap; gap: 1rem; align-items: end;
    margin-bottom: 0.9rem; padding: 0.75rem 0.9rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
  }
  .filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--ink-soft); font-weight: 700; }
  .filters select {
    padding: 0.4rem 0.5rem; border: 1px solid var(--line-soft);
    border-radius: 0.4rem; background: var(--surface-raised); color: var(--ink-strong);
  }
  .shown { margin-left: auto; color: var(--ink-muted); font-size: 0.8rem; }
  .layout { display: grid; grid-template-columns: 1fr; gap: 0.9rem; }
  .layout.has-detail { grid-template-columns: 1fr 22rem; }
  .gantt { display: flex; flex-direction: column; gap: 0.3rem; }
  .row {
    display: grid; grid-template-columns: 16rem 1fr; gap: 0.6rem;
    align-items: center; width: 100%; text-align: left; cursor: pointer;
    padding: 0.4rem 0.5rem; border: 1px solid transparent;
    border-radius: 0.5rem; background: var(--surface-card); color: var(--ink-strong);
  }
  .row:hover { border-color: var(--line-soft); }
  .row.sel { border-color: var(--accent); }
  .row.hl { background: color-mix(in srgb, var(--warn) 22%, var(--surface-card)); }
  .left { display: flex; justify-content: space-between; gap: 0.5rem; min-width: 0; }
  .subj { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; }
  .pri { flex: 0 0 auto; color: var(--ink-soft); font-size: 0.78rem; font-weight: 800; }
  .lane { position: relative; height: 1.3rem; background: var(--surface-raised); border-radius: 0.3rem; }
  .bar {
    position: absolute; top: 0; bottom: 0; min-width: 0.5rem;
    border-radius: 0.3rem; background: var(--accent);
  }
  .bar[data-status='completed'] { background: var(--ok); }
  .bar[data-status='blocked'] { background: var(--warn); }
  .bar[data-status='deleted'] { background: var(--ink-muted); }
  .dep {
    position: absolute; right: 0.3rem; top: 50%; transform: translateY(-50%);
    font-size: 0.72rem; font-weight: 800; color: var(--warn); cursor: help;
  }
  .empty {
    margin: 0; padding: 1rem; color: var(--ink-soft);
    border: 1px dashed var(--line-soft); border-radius: 0.6rem;
  }
  .view-toggle {
    display: inline-flex; gap: 0; margin-bottom: 0.9rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.6rem; padding: 0.2rem; width: max-content;
  }
  .vt-btn {
    padding: 0.35rem 0.9rem; border: none; cursor: pointer;
    background: transparent; color: var(--ink-soft);
    font-size: 0.84rem; font-weight: 700;
    border-radius: 0.45rem;
  }
  .vt-btn.active { background: var(--surface-raised); color: var(--ink-strong); }
  .vt-btn:hover:not(.active) { color: var(--ink-strong); }
</style>
