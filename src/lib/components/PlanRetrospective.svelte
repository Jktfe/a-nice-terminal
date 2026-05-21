<!--
  PlanRetrospective — Lane-D read-only retro view.
  Renders a summary header (donut + status counts + total time tracked),
  a single proportional status breakdown bar, and a per-task table sorted
  by createdAtMs ASC. No mutation surfaces; pure projection of the
  per-plan tasks feed.
-->
<script lang="ts">
  import PlanDonutCard from './PlanDonutCard.svelte';
  import type { Task, TaskStatus } from '$lib/server/taskStore';

  type Props = {
    planId: string;
    completion: { planId: string; title: string | null; total: number; completed: number; pct: number };
    tasks: Task[];
  };
  let { planId, completion, tasks }: Props = $props();

  const sorted = $derived([...tasks].sort((a, b) => a.createdAtMs - b.createdAtMs));

  function countBy(status: TaskStatus): number {
    return tasks.filter((t) => t.status === status).length;
  }
  const counts = $derived({
    completed: countBy('completed'),
    in_progress: countBy('in_progress'),
    blocked: countBy('blocked'),
    pending: countBy('pending'),
    deleted: countBy('deleted')
  });

  // Sum of durations across tasks where BOTH started+ended are set.
  const totalMs = $derived(
    tasks.reduce((sum, t) => {
      if (t.startedAtMs !== null && t.endedAtMs !== null && t.endedAtMs > t.startedAtMs) {
        return sum + (t.endedAtMs - t.startedAtMs);
      }
      return sum;
    }, 0)
  );

  function fmtDuration(ms: number): string {
    if (ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) {
      const rs = s % 60;
      return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
    }
    const h = Math.floor(m / 60);
    if (h < 24) {
      const rm = m % 60;
      return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
    }
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }

  function fmtTaskDuration(t: Task): string {
    if (t.startedAtMs === null || t.endedAtMs === null) return '—';
    if (t.endedAtMs <= t.startedAtMs) return '—';
    return fmtDuration(t.endedAtMs - t.startedAtMs);
  }

  function fmtTime(ms: number | null): string {
    return ms === null ? '—' : new Date(ms).toLocaleString();
  }

  function blockerSubjects(t: Task): string {
    return t.blockedBy
      .map((id) => tasks.find((x) => x.id === id)?.subject ?? id)
      .join(', ');
  }

  // Status-bar segments — completed | in_progress | blocked | pending.
  // Deleted is intentionally skipped per contract. Widths proportional
  // to the segment denominator (sum of those four), so a plan with only
  // a couple of statuses still fills the bar.
  const segDenom = $derived(
    counts.completed + counts.in_progress + counts.blocked + counts.pending
  );
  function segPct(n: number): number {
    return segDenom === 0 ? 0 : (n / segDenom) * 100;
  }

  const label = $derived(completion.title ?? planId);
</script>

<section class="retro" aria-label="Plan retrospective">
  <div class="header">
    <PlanDonutCard
      {label}
      total={completion.total}
      completed={completion.completed}
      pct={completion.pct}
    />
    <ul class="stats" aria-label="Status counts">
      <li><strong>{tasks.length}</strong> tasks total</li>
      <li><strong>{counts.completed}</strong> completed</li>
      <li><strong>{counts.in_progress}</strong> in-progress</li>
      <li><strong>{counts.blocked}</strong> blocked</li>
      <li><strong>{counts.pending}</strong> pending</li>
      <li class="time">Total time tracked: <strong>{fmtDuration(totalMs)}</strong></li>
    </ul>
  </div>

  {#if tasks.length === 0}
    <p class="empty">No tasks yet. Add tasks to this plan to see its retrospective.</p>
  {:else}
    <div class="breakdown" role="img" aria-label="Status breakdown bar">
      {#if counts.completed > 0}
        <span class="seg completed"
              style={`width:${segPct(counts.completed)}%`}
              title={`${counts.completed} completed`}></span>
      {/if}
      {#if counts.in_progress > 0}
        <span class="seg in_progress"
              style={`width:${segPct(counts.in_progress)}%`}
              title={`${counts.in_progress} in-progress`}></span>
      {/if}
      {#if counts.blocked > 0}
        <span class="seg blocked"
              style={`width:${segPct(counts.blocked)}%`}
              title={`${counts.blocked} blocked`}></span>
      {/if}
      {#if counts.pending > 0}
        <span class="seg pending"
              style={`width:${segPct(counts.pending)}%`}
              title={`${counts.pending} pending`}></span>
      {/if}
    </div>

    <div class="table-wrap">
      <table class="tasks">
        <thead>
          <tr>
            <th class="subj">Subject</th>
            <th class="pri">Priority</th>
            <th>Status</th>
            <th>Started</th>
            <th>Ended</th>
            <th>Duration</th>
            <th>Evidence</th>
            <th>Blocked by</th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as t (t.id)}
            <tr>
              <td class="subj" title={t.subject}>{t.subject}</td>
              <td class="pri">{t.priority ?? '—'}</td>
              <td>
                <span class="chip" data-status={t.status}>{t.status}</span>
              </td>
              <td>{fmtTime(t.startedAtMs)}</td>
              <td>{fmtTime(t.endedAtMs)}</td>
              <td>{fmtTaskDuration(t)}</td>
              <td>{t.evidence.length === 0 ? '—' : t.evidence.length}</td>
              <td>
                {#if t.blockedBy.length > 0}
                  <span class="dep" title={`Blocked by: ${blockerSubjects(t)}`}>
                    ⇠ {t.blockedBy.length}
                  </span>
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .retro { display: flex; flex-direction: column; gap: 0.9rem; }
  .header {
    display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;
    padding: 0.75rem 0.9rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
  }
  .stats {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem;
    color: var(--ink-soft); font-size: 0.85rem;
  }
  .stats strong { color: var(--ink-strong); font-weight: 800; }
  .stats .time { flex-basis: 100%; margin-top: 0.2rem; }
  .breakdown {
    display: flex; width: 100%; height: 0.9rem;
    background: var(--surface-raised); border: 1px solid var(--line-soft);
    border-radius: 0.45rem; overflow: hidden;
  }
  .seg { display: block; height: 100%; min-width: 0.2rem; }
  .seg.completed { background: var(--ok); }
  .seg.in_progress { background: var(--warn); }
  .seg.blocked { background: color-mix(in srgb, var(--warn) 60%, var(--accent) 40%); }
  .seg.pending { background: var(--ink-muted); }
  .table-wrap {
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.75rem; overflow: auto;
  }
  table.tasks {
    width: 100%; border-collapse: collapse;
    font-size: 0.85rem; color: var(--ink-strong);
  }
  table.tasks th, table.tasks td {
    padding: 0.5rem 0.7rem; text-align: left;
    border-bottom: 1px solid var(--line-soft); vertical-align: top;
  }
  table.tasks th {
    font-size: 0.74rem; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--ink-soft); font-weight: 800;
  }
  table.tasks tbody tr:last-child td { border-bottom: none; }
  td.subj {
    max-width: 22rem; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.pri, th.pri { color: var(--ink-soft); font-weight: 800; }
  .chip {
    display: inline-block; padding: 0.1rem 0.5rem;
    border-radius: 999px; font-size: 0.74rem; font-weight: 800;
    text-transform: capitalize;
    background: var(--surface-raised); color: var(--ink-strong);
    border: 1px solid var(--line-soft);
  }
  .chip[data-status='completed'] {
    background: color-mix(in srgb, var(--ok) 18%, var(--surface-card));
    border-color: var(--ok); color: var(--ink-strong);
  }
  .chip[data-status='in_progress'] {
    background: color-mix(in srgb, var(--warn) 22%, var(--surface-card));
    border-color: var(--warn);
  }
  .chip[data-status='blocked'] {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-card));
    border-color: var(--accent);
  }
  .chip[data-status='pending'] { color: var(--ink-soft); }
  .chip[data-status='deleted'] { color: var(--ink-muted); }
  .dep {
    display: inline-block; padding: 0.05rem 0.4rem;
    border-radius: 0.3rem; background: color-mix(in srgb, var(--warn) 22%, var(--surface-card));
    color: var(--warn); font-weight: 800; cursor: help; font-size: 0.78rem;
  }
  .empty {
    margin: 0; padding: 1rem; color: var(--ink-soft);
    border: 1px dashed var(--line-soft); border-radius: 0.6rem;
  }
</style>
