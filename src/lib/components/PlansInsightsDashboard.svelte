<!--
  PlansInsightsDashboard — projection of `computeInsights()` from
  planInsightsStore. Pure read-only rendering: top-line cards, status +
  priority breakdown bars, top plans/rooms tables, most-blocked list,
  and duration roll-up. Every section has a graceful empty state.
-->
<script lang="ts">
  import type { PlansInsights } from '$lib/server/planInsightsStore';

  type Props = { insights: PlansInsights };
  let { insights }: Props = $props();

  function fmtPct(p: number): string {
    return `${Math.round(p * 100)}%`;
  }

  function fmtDuration(ms: number): string {
    if (ms <= 0) return '0s';
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

  function segPct(n: number, denom: number): number {
    return denom === 0 ? 0 : (n / denom) * 100;
  }

  const statusDenom = $derived(
    insights.tasks.byStatus.pending +
      insights.tasks.byStatus.in_progress +
      insights.tasks.byStatus.blocked +
      insights.tasks.byStatus.completed
  );
  const priorityDenom = $derived(
    Object.values(insights.tasks.byPriority).reduce((a, b) => a + b, 0)
  );

  const priorityOrder = ['1', '2', '3', 'none'];
</script>

<section class="cards" aria-label="Headline counts">
  <div class="card">
    <span class="big">{insights.plans.total}</span>
    <span class="label">Total plans</span>
    <span class="sub">{insights.plans.active} active · {insights.plans.archived} archived</span>
  </div>
  <div class="card">
    <span class="big">{insights.tasks.total}</span>
    <span class="label">Total tasks</span>
    <span class="sub">{insights.tasks.byStatus.completed} done · {insights.tasks.standalone} standalone</span>
  </div>
  <div class="card">
    <span class="big">{fmtPct(insights.plans.avgCompletionPctActive)}</span>
    <span class="label">Avg completion (active)</span>
    <span class="sub">across {insights.plans.active} active plans</span>
  </div>
  <div class="card">
    <span class="big">{insights.duration ? fmtDuration(insights.duration.totalMs) : '—'}</span>
    <span class="label">Total time tracked</span>
    <span class="sub">{insights.duration ? `${insights.duration.measuredCount} measured tasks` : 'no timestamped tasks'}</span>
  </div>
</section>

<section class="block" aria-label="Status breakdown">
  <h2>Status breakdown</h2>
  {#if statusDenom === 0}
    <p class="empty">No live tasks to chart.</p>
  {:else}
    <div class="breakdown" role="img" aria-label="Status proportions">
      {#if insights.tasks.byStatus.completed > 0}
        <span class="seg completed" style={`width:${segPct(insights.tasks.byStatus.completed, statusDenom)}%`} title={`${insights.tasks.byStatus.completed} completed`}></span>
      {/if}
      {#if insights.tasks.byStatus.in_progress > 0}
        <span class="seg in_progress" style={`width:${segPct(insights.tasks.byStatus.in_progress, statusDenom)}%`} title={`${insights.tasks.byStatus.in_progress} in-progress`}></span>
      {/if}
      {#if insights.tasks.byStatus.blocked > 0}
        <span class="seg blocked" style={`width:${segPct(insights.tasks.byStatus.blocked, statusDenom)}%`} title={`${insights.tasks.byStatus.blocked} blocked`}></span>
      {/if}
      {#if insights.tasks.byStatus.pending > 0}
        <span class="seg pending" style={`width:${segPct(insights.tasks.byStatus.pending, statusDenom)}%`} title={`${insights.tasks.byStatus.pending} pending`}></span>
      {/if}
    </div>
    <ul class="legend">
      <li><span class="dot completed"></span>completed · {insights.tasks.byStatus.completed}</li>
      <li><span class="dot in_progress"></span>in-progress · {insights.tasks.byStatus.in_progress}</li>
      <li><span class="dot blocked"></span>blocked · {insights.tasks.byStatus.blocked}</li>
      <li><span class="dot pending"></span>pending · {insights.tasks.byStatus.pending}</li>
    </ul>
  {/if}
</section>

<section class="block" aria-label="Top plans">
  <h2>Top plans</h2>
  {#if insights.topPlans.byCompletedCount.length === 0 && insights.topPlans.byTotalCount.length === 0}
    <p class="empty">No plans with tasks yet.</p>
  {:else}
    <div class="two-col">
      <div>
        <h3>By completed count</h3>
        {#if insights.topPlans.byCompletedCount.length === 0}
          <p class="empty mini">No completed tasks.</p>
        {:else}
          <table>
            <tbody>
              {#each insights.topPlans.byCompletedCount as p (p.planId)}
                <tr>
                  <td class="title"><a href={`/plans/${p.planId}`}>{p.title ?? p.planId}</a></td>
                  <td class="bar"><span class="mini-bar"><span style={`width:${p.pct * 100}%`}></span></span></td>
                  <td class="pct">{p.completed}/{p.total} · {fmtPct(p.pct)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div>
        <h3>By total count</h3>
        {#if insights.topPlans.byTotalCount.length === 0}
          <p class="empty mini">No tasks yet.</p>
        {:else}
          <table>
            <tbody>
              {#each insights.topPlans.byTotalCount as p (p.planId)}
                <tr>
                  <td class="title"><a href={`/plans/${p.planId}`}>{p.title ?? p.planId}</a></td>
                  <td class="bar"><span class="mini-bar"><span style={`width:${p.pct * 100}%`}></span></span></td>
                  <td class="pct">{p.completed}/{p.total} · {fmtPct(p.pct)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/if}
</section>

<section class="block" aria-label="Top rooms">
  <h2>Top rooms</h2>
  {#if insights.topRooms.length === 0}
    <p class="empty">No plans attached to rooms yet.</p>
  {:else}
    <table class="rooms">
      <tbody>
        {#each insights.topRooms as r (r.roomId)}
          <tr>
            <td class="title"><a href={`/rooms/${r.roomId}`}>{r.roomName}</a></td>
            <td class="pct">{r.planCount} plans</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section class="block" aria-label="Most-blocked tasks">
  <h2>Most-blocked tasks</h2>
  {#if insights.mostBlockedTasks.length === 0}
    <p class="empty">No blocked tasks — nothing waiting on a dependency.</p>
  {:else}
    <ul class="blocked-list">
      {#each insights.mostBlockedTasks as t (t.taskId)}
        <li>
          <span class="subj">{t.subject}</span>
          {#if t.planId} · <a href={`/plans/${t.planId}`}>{t.planId}</a>{/if}
          <span class="chip">⇠ {t.blockedByCount}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if insights.duration}
  <section class="block" aria-label="Duration stats">
    <h2>Duration stats</h2>
    <div class="duration-grid">
      <div><span class="big">{fmtDuration(insights.duration.medianMs)}</span><span class="label">Median</span></div>
      <div><span class="big">{fmtDuration(insights.duration.avgMs)}</span><span class="label">Average</span></div>
      <div><span class="big">{fmtDuration(insights.duration.minMs)}</span><span class="label">Min</span></div>
      <div><span class="big">{fmtDuration(insights.duration.maxMs)}</span><span class="label">Max</span></div>
    </div>
  </section>
{/if}

<section class="block" aria-label="Priority breakdown">
  <h2>Priority breakdown</h2>
  {#if priorityDenom === 0}
    <p class="empty">No tasks to chart.</p>
  {:else}
    <div class="breakdown" role="img" aria-label="Priority proportions">
      {#each priorityOrder as key (key)}
        {#if (insights.tasks.byPriority[key] ?? 0) > 0}
          <span class={`seg pri-${key}`} style={`width:${segPct(insights.tasks.byPriority[key] ?? 0, priorityDenom)}%`} title={`priority ${key}: ${insights.tasks.byPriority[key]}`}></span>
        {/if}
      {/each}
    </div>
    <ul class="legend">
      {#each priorityOrder as key (key)}
        <li><span class={`dot pri-${key}`}></span>{key === 'none' ? 'no priority' : `P${key}`} · {insights.tasks.byPriority[key] ?? 0}</li>
      {/each}
    </ul>
  {/if}
</section>

<section class="block" aria-label="Dependency density">
  <h2>Dependency graph</h2>
  <p class="dep-line">
    <strong>{insights.dependencies.taskCount}</strong> tasks ·
    <strong>{insights.dependencies.edgeCount}</strong> dependency edges
  </p>
</section>

<style>
  .cards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.9rem; margin-bottom: 1.4rem;
  }
  .card {
    display: flex; flex-direction: column; gap: 0.25rem;
    padding: 1rem 1.1rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
  }
  .card .big { font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--ink-strong); }
  .card .label {
    font-size: 0.78rem; color: var(--ink-soft);
    text-transform: uppercase; font-weight: 800; letter-spacing: 0.04em;
  }
  .card .sub { font-size: 0.78rem; color: var(--ink-muted); }
  .block {
    margin-bottom: 1.4rem; padding: 1rem 1.1rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
  }
  .block h2 {
    margin: 0 0 0.7rem; font-size: 0.92rem; color: var(--ink-strong);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .block h3 {
    margin: 0 0 0.45rem; font-size: 0.78rem; color: var(--ink-soft);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
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
  .seg.pri-1 { background: var(--accent); }
  .seg.pri-2 { background: color-mix(in srgb, var(--accent) 65%, var(--warn) 35%); }
  .seg.pri-3 { background: var(--warn); }
  .seg.pri-none { background: var(--ink-muted); }
  .legend {
    display: flex; flex-wrap: wrap; gap: 0.4rem 1rem;
    list-style: none; margin: 0.6rem 0 0; padding: 0;
    font-size: 0.78rem; color: var(--ink-soft);
  }
  .legend .dot {
    display: inline-block; width: 0.6rem; height: 0.6rem;
    margin-right: 0.35rem; border-radius: 999px; vertical-align: middle;
  }
  .legend .dot.completed { background: var(--ok); }
  .legend .dot.in_progress { background: var(--warn); }
  .legend .dot.blocked { background: color-mix(in srgb, var(--warn) 60%, var(--accent) 40%); }
  .legend .dot.pending { background: var(--ink-muted); }
  .legend .dot.pri-1 { background: var(--accent); }
  .legend .dot.pri-2 { background: color-mix(in srgb, var(--accent) 65%, var(--warn) 35%); }
  .legend .dot.pri-3 { background: var(--warn); }
  .legend .dot.pri-none { background: var(--ink-muted); }
  .two-col {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1rem;
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; color: var(--ink-strong); }
  table td {
    padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--line-soft);
    vertical-align: middle;
  }
  table tbody tr:last-child td { border-bottom: none; }
  td.title a { color: var(--ink-strong); text-decoration: none; font-weight: 700; }
  td.title a:hover { color: var(--accent); }
  td.pct {
    text-align: right; color: var(--ink-soft);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  td.bar { width: 35%; }
  .mini-bar {
    display: block; width: 100%; height: 0.5rem;
    background: var(--surface-raised); border-radius: 999px; overflow: hidden;
  }
  .mini-bar span { display: block; height: 100%; background: var(--ok); }
  table.rooms td.title { width: 70%; }
  .blocked-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 0.4rem;
    font-size: 0.85rem; color: var(--ink-strong);
  }
  .blocked-list a { color: var(--ink-soft); text-decoration: none; }
  .blocked-list a:hover { color: var(--accent); }
  .blocked-list .subj { font-weight: 700; }
  .blocked-list .chip {
    display: inline-block; margin-left: 0.45rem;
    padding: 0.05rem 0.45rem; border-radius: 0.3rem;
    background: color-mix(in srgb, var(--warn) 22%, var(--surface-card));
    color: var(--warn); font-weight: 800; font-size: 0.78rem;
  }
  .duration-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.7rem;
  }
  .duration-grid div {
    display: flex; flex-direction: column; gap: 0.2rem;
    padding: 0.6rem 0.75rem;
    background: var(--surface-raised); border: 1px solid var(--line-soft);
    border-radius: 0.6rem;
  }
  .duration-grid .big { font-size: 1.1rem; font-weight: 800; color: var(--ink-strong); }
  .duration-grid .label {
    font-size: 0.72rem; color: var(--ink-soft);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .dep-line { margin: 0; color: var(--ink-soft); font-size: 0.9rem; }
  .dep-line strong { color: var(--ink-strong); font-weight: 800; }
  .empty {
    margin: 0; padding: 0.7rem 0.85rem;
    color: var(--ink-soft); border: 1px dashed var(--line-soft);
    border-radius: 0.55rem; font-size: 0.88rem;
  }
  .empty.mini { padding: 0.4rem 0.55rem; font-size: 0.82rem; }
</style>
