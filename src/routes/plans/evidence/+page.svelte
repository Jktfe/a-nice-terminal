<!--
  /plans/evidence — Lane-D PLANS Evidence Harvest.
  Surfaces every `task.evidence[]` entry across non-deleted tasks as a
  unified, filterable, searchable corpus. URL-driven filters so links are
  shareable. Distinct from /plans (donut index) and /plans/[planId]
  (per-plan Gantt).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { TaskEvidenceKind } from '$lib/server/planEvidenceStore';
  import type { EvidenceRow } from '$lib/server/planEvidenceStore';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const KIND_ORDER: TaskEvidenceKind[] = [
    'run_event',
    'task',
    'url',
    'file',
    'chat_message',
    'proposal',
    'stage_focus',
    'stage_pause_context',
    'stage_feedback',
    'stage_alternative'
  ];
  const KIND_LABEL: Record<TaskEvidenceKind, string> = {
    run_event: 'run event',
    task: 'task',
    url: 'url',
    file: 'file',
    chat_message: 'chat',
    proposal: 'proposal',
    stage_focus: 'stage focus',
    stage_pause_context: 'stage pause',
    stage_feedback: 'stage feedback',
    stage_alternative: 'stage alternative'
  };
  const KIND_ICON: Record<TaskEvidenceKind, string> = {
    run_event: 'R',
    task: 'T',
    url: 'U',
    file: 'F',
    chat_message: 'C',
    proposal: 'P',
    stage_focus: 'S',
    stage_pause_context: 'P',
    stage_feedback: 'F',
    stage_alternative: 'A'
  };

  // Local search input, primed from URL on load. Submitting the form
  // pushes the new ?q= back into the URL so a refresh keeps state.
  // svelte-ignore state_referenced_locally — init-from-prop is intentional.
  let qInput = $state<string>(data.filter.q ?? '');

  function buildHref(patch: { kind?: TaskEvidenceKind | null; q?: string | null; planId?: string | null }): string {
    const qs = new URLSearchParams();
    const nextKind = patch.kind !== undefined ? patch.kind : data.filter.kind;
    const nextQ = patch.q !== undefined ? patch.q : data.filter.q;
    const nextPlan = patch.planId !== undefined ? patch.planId : data.filter.planId;
    if (nextKind) qs.set('kind', nextKind);
    if (nextQ) qs.set('q', nextQ);
    if (nextPlan) qs.set('planId', nextPlan);
    const suffix = qs.toString();
    return `/plans/evidence${suffix ? `?${suffix}` : ''}`;
  }

  function submitSearch(e: Event): void {
    e.preventDefault();
    goto(buildHref({ q: qInput.trim() ? qInput.trim() : null }), { keepFocus: true });
  }

  function pickKind(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    const next = value === 'all' ? null : (value as TaskEvidenceKind);
    goto(buildHref({ kind: next }));
  }

  const grouped = $derived.by(() => {
    const map = new Map<TaskEvidenceKind, EvidenceRow[]>();
    for (const row of data.evidence) {
      const list = map.get(row.kind) ?? [];
      list.push(row);
      map.set(row.kind, list);
    }
    return KIND_ORDER
      .filter((k) => map.has(k))
      .map((k) => ({ kind: k, rows: map.get(k) as EvidenceRow[] }));
  });

  const filtersActive = $derived(
    !!(data.filter.kind || data.filter.q || data.filter.planId)
  );

  function planHref(planId: string): string {
    return `/plans/${encodeURIComponent(planId)}`;
  }
  function taskHref(row: EvidenceRow): string {
    return row.planId
      ? `/plans/${encodeURIComponent(row.planId)}?task=${encodeURIComponent(row.taskId)}`
      : `/plans?task=${encodeURIComponent(row.taskId)}`;
  }
</script>

<svelte:head><title>Evidence | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Plans · Evidence"
  title="Evidence."
  summary="Every reference, file, link, and event attached to a task. Search across the whole corpus."
>
  <a class="back" href="/plans">← All plans</a>

  <section class="stats" aria-label="Evidence totals">
    <span class="total">{data.stats.total} total</span>
    {#each KIND_ORDER as k (k)}
      {#if data.stats.byKind[k] > 0}
        <a
          class="chip"
          class:active={data.filter.kind === k}
          href={buildHref({ kind: data.filter.kind === k ? null : k })}
        >{data.stats.byKind[k]} {KIND_LABEL[k]}</a>
      {/if}
    {/each}
    {#if data.stats.withLabel > 0}
      <span class="chip mute">{data.stats.withLabel} labelled</span>
    {/if}
  </section>

  <section class="filters" aria-label="Filter evidence">
    <form onsubmit={submitSearch}>
      <input
        type="search"
        bind:value={qInput}
        placeholder="Search ref / label / task subject…"
        aria-label="Search evidence"
      />
      <button type="submit">Search</button>
    </form>
    <label class="kind-select">
      Kind
      <select onchange={pickKind} value={data.filter.kind ?? 'all'}>
        <option value="all">All</option>
        {#each KIND_ORDER as k (k)}
          <option value={k}>{KIND_LABEL[k]}</option>
        {/each}
      </select>
    </label>
    {#if data.filter.planId}
      <a class="chip active" href={buildHref({ planId: null })}
        >plan: {data.filter.planId} ×</a
      >
    {/if}
    {#if filtersActive}
      <a class="reset" href="/plans/evidence">Reset</a>
    {/if}
  </section>

  {#if data.stats.total === 0}
    <p class="empty">No evidence captured yet. Attach evidence to a task
      via the task API (the <code>evidence</code> array on a task) and it
      will appear here.</p>
  {:else if data.evidence.length === 0}
    <p class="empty">No evidence matches these filters.
      <a href="/plans/evidence">Reset filters</a>.</p>
  {:else}
    {#each grouped as group (group.kind)}
      <section class="group">
        <h2>
          <span class="kind-icon" data-kind={group.kind}>{KIND_ICON[group.kind]}</span>
          {KIND_LABEL[group.kind]}
          <span class="count">{group.rows.length}</span>
        </h2>
        <ul>
          {#each group.rows as row (row.taskId + ':' + row.kind + ':' + row.ref)}
            <li>
              <div class="ref">
                {#if row.kind === 'url'}
                  <a href={row.ref} target="_blank" rel="noopener noreferrer">{row.ref}</a>
                {:else if row.kind === 'file'}
                  <code>{row.ref}</code>
                {:else}
                  <span class="ref-text">{row.ref}</span>
                {/if}
                {#if row.label}<span class="label">— {row.label}</span>{/if}
              </div>
              <div class="meta">
                <a class="task-link" href={taskHref(row)}>{row.taskSubject}</a>
                {#if row.planId}
                  <span class="dot">·</span>
                  <a class="plan-link" href={planHref(row.planId)}
                    >{row.planTitle ?? row.planId}</a
                  >
                {:else}
                  <span class="dot">·</span>
                  <span class="standalone">standalone</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</SimplePageShell>

<style>
  .back {
    display: inline-block;
    margin: 0.5rem 0 1rem;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
  }
  .back:hover { color: var(--ink-strong); }
  .stats { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin: 1rem 0 0.6rem; }
  .total { padding: 0.35rem 0.7rem; border-radius: 999px; background: var(--accent); color: white; font-weight: 800; }
  .chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0.65rem; border-radius: 999px; border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong); font-size: 0.85rem; font-weight: 700; text-decoration: none; }
  .chip.active { background: var(--accent); color: white; border-color: var(--accent); }
  .chip.mute { color: var(--ink-soft); font-weight: 600; }
  .filters { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin: 0 0 1.2rem; }
  .filters form { display: flex; gap: 0.4rem; flex: 1 1 16rem; }
  .filters input[type='search'] { flex: 1 1 12rem; min-width: 8rem; padding: 0.5rem 0.7rem; border: 1px solid var(--line-soft); border-radius: 0.6rem; background: var(--surface-card); color: var(--ink-strong); font: inherit; }
  .filters button { padding: 0.5rem 0.95rem; border: 1px solid var(--accent); background: var(--accent); color: white; border-radius: 0.6rem; font-weight: 800; cursor: pointer; }
  .kind-select { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--ink-soft); font-size: 0.9rem; }
  .kind-select select { padding: 0.4rem 0.5rem; border-radius: 0.5rem; border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong); font: inherit; }
  .reset { color: var(--ink-soft); font-size: 0.85rem; text-decoration: underline; }
  .empty { margin: 1rem 0; padding: 1rem 1.1rem; line-height: 1.5; border: 1px dashed var(--line-soft); border-radius: 0.85rem; background: var(--surface-card); color: var(--ink-soft); }
  .empty code { padding: 0.05rem 0.3rem; border-radius: 0.3rem; background: rgb(0 0 0 / 6%); font-size: 0.85em; }
  .group { margin: 1.4rem 0; border: 1px solid var(--line-soft); border-radius: 0.9rem; background: var(--surface-card); overflow: hidden; }
  .group h2 { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.7rem 1rem; border-bottom: 1px solid var(--line-soft); font-size: 0.95rem; text-transform: capitalize; }
  .group h2 .count { margin-left: auto; padding: 0.1rem 0.5rem; border-radius: 999px; background: var(--line-soft); color: var(--ink-strong); font-size: 0.8rem; font-weight: 700; }
  .kind-icon { display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 0.5rem; background: var(--accent); color: white; font-weight: 900; font-size: 0.8rem; }
  .group ul { list-style: none; margin: 0; padding: 0; }
  .group li { padding: 0.65rem 1rem; border-top: 1px solid var(--line-soft); }
  .group li:first-child { border-top: 0; }
  .ref { font-size: 0.95rem; word-break: break-all; }
  .ref a { color: var(--accent); text-decoration: none; font-weight: 700; }
  .ref a:hover { text-decoration: underline; }
  .ref code { padding: 0.1rem 0.4rem; border-radius: 0.3rem; background: rgb(0 0 0 / 6%); font-size: 0.9em; }
  .ref .ref-text { color: var(--ink-strong); font-weight: 600; }
  .label { color: var(--ink-soft); margin-left: 0.3rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.25rem; font-size: 0.85rem; color: var(--ink-soft); }
  .meta a { color: var(--ink-soft); text-decoration: underline; }
  .meta a:hover { color: var(--ink-strong); }
  .standalone { font-style: italic; }
  .dot { opacity: 0.6; }
</style>
