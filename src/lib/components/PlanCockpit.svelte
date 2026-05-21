<!--
  PlanCockpit — Task #136b. High-level overview of a plan, sitting above
  the Gantt/retro views on /plans/[planId]. Consumes the cockpit
  projection shipped in #136a (fe348b4): GET /api/plans/:planId/cockpit
  returns { plan, progress, phases, unphasedTasks, rooms, recentActivity }.

  Read-only summary surface — actionable edits remain in the Gantt's
  TaskDetailPanel + plan-level CLI.
-->
<script lang="ts">
  import Skeleton from './Skeleton.svelte';
  import PlanCockpitUnphased from './PlanCockpitUnphased.svelte';

  type Lifecycle = 'active' | 'archived' | 'deleted';

  type Plan = {
    id: string;
    title: string | null;
    description: string | null;
    lifecycle: Lifecycle;
  };

  type ProgressCount = { total: number; completed: number; pct: number };
  // Server returns phase progress as `metric & { id, title }` — id/title at
  // the top, not nested under `.completion`. Older shape (.phaseId/.completion)
  // crashed plans with phases at render time (#136b-fix2).
  type PhaseProgress = ProgressCount & { id: string; title: string };

  type CockpitTask = {
    id: string;
    subject: string;
    status: string;
    priority: number | null;
    assignedAgent: string | null;
  };

  type RoomLink = {
    roomId: string;
    name: string;
    attachedAtMs: number;
    attachedBy: string | null;
  };

  type RecentActivityEntry = {
    kind: string;
    refId: string;
    title: string | null;
    status?: string | null;
    actor?: string | null;
    atMs: number;
  };

  type Cockpit = {
    plan: Plan;
    progress: {
      tasks: ProgressCount;
      phases: PhaseProgress[];
      milestones: ProgressCount;
    };
    unphasedTasks: CockpitTask[];
    rooms?: RoomLink[];
    recentActivity?: RecentActivityEntry[];
  };

  type Props = {
    planId: string;
    onSelectTask?: (taskId: string) => void;
  };

  let { planId, onSelectTask }: Props = $props();

  let cockpit = $state<Cockpit | null>(null);
  let isLoading = $state(true);
  let errorMessage = $state('');
  // #136c live evidence/comments: cockpit now polls the projection every
  // 15s so task/evidence/comment activity surfaces without a manual reload.
  // A live pill in the header shows the freshness; polling pauses while
  // the tab is hidden to avoid burning cycles on unattended windows.
  let lastRefreshedAtMs = $state<number | null>(null);
  let isRefreshing = $state(false);
  const POLL_INTERVAL_MS = 15_000;

  async function refreshFromServer(opts: { background?: boolean } = {}) {
    if (opts.background) {
      isRefreshing = true;
    } else {
      isLoading = true;
    }
    if (!opts.background) errorMessage = '';
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/cockpit`);
      if (!response.ok) throw new Error(`Could not load plan dashboard (${response.status}).`);
      const body = (await response.json()) as { cockpit: Cockpit };
      cockpit = body.cockpit;
      lastRefreshedAtMs = Date.now();
      if (opts.background) errorMessage = '';
    } catch (cause) {
      if (!opts.background) {
        errorMessage = cause instanceof Error ? cause.message : 'Could not load plan dashboard.';
      }
    } finally {
      isLoading = false;
      isRefreshing = false;
    }
  }

  $effect(() => {
    if (!planId) return;
    void refreshFromServer();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshFromServer({ background: true });
    }, POLL_INTERVAL_MS);
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
  });

  // "Updated 8s ago" pill — tick once per second on a $derived basis so
  // the operator sees the relative freshness changing rather than a frozen
  // timestamp. We pin to `now` reactively via a small interval that bumps
  // a $state value; the label derives from (now - lastRefreshedAtMs).
  let nowMs = $state(Date.now());
  $effect(() => {
    const tick = setInterval(() => { nowMs = Date.now(); }, 1000);
    return () => clearInterval(tick);
  });
  const freshnessLabel = $derived.by(() => {
    if (lastRefreshedAtMs === null) return '';
    const deltaSec = Math.max(0, Math.floor((nowMs - lastRefreshedAtMs) / 1000));
    if (deltaSec < 5) return 'just now';
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const min = Math.floor(deltaSec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  });

  function pctText(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  // #169 UNPHASED grouping (Active/Completed split + collapsed-by-default
  // completed pile) now lives in PlanCockpitUnphased.svelte to keep this
  // file under the 600-line component cap.
</script>

<section class="plan-cockpit" aria-label="Plan dashboard">
  {#if isLoading}
    <!-- Loading plan dashboard skeleton — shaped like the eventual stats
         grid + section list so the layout doesn't shift on hydrate.
         aria-label "Loading plan dashboard" preserved for SR + the
         existing planDetailLabels test. -->
    <div class="cockpit-loading" aria-label="Loading plan dashboard" role="status">
      <Skeleton height="1.6rem" width="60%" rounded="md" />
      <div class="cockpit-stats" aria-hidden="true">
        {#each Array.from({ length: 4 }) as _, i (i)}
          <div class="stat-card"><Skeleton height="2.6rem" rounded="md" /></div>
        {/each}
      </div>
      <Skeleton height="1.05rem" width="40%" rounded="sm" />
      <Skeleton lines={3} height="0.85rem" rounded="sm" />
    </div>
  {:else if errorMessage}
    <div class="cockpit-error" role="alert">
      <div class="error-text">
        <strong>Couldn't load this plan dashboard.</strong>
        <span class="error-detail">{errorMessage}</span>
      </div>
      <button type="button" class="error-retry" onclick={() => void refreshFromServer()}>
        Try again
      </button>
    </div>
  {:else if cockpit}
    <header class="cockpit-header">
      <div class="cockpit-title-row">
        <h2>{cockpit.plan.title ?? cockpit.plan.id}</h2>
        <span class={`lifecycle lifecycle-${cockpit.plan.lifecycle}`}>{cockpit.plan.lifecycle}</span>
        {#if freshnessLabel}
          <span class="freshness-pill" class:is-refreshing={isRefreshing} title={`Updated ${freshnessLabel} — polls every ${POLL_INTERVAL_MS / 1000}s`}>
            <span class="freshness-dot" aria-hidden="true"></span>
            Live · updated {freshnessLabel}
          </span>
        {/if}
      </div>
      {#if cockpit.plan.description}
        <p class="cockpit-description">{cockpit.plan.description}</p>
      {/if}
    </header>

    <section class="cockpit-stats" aria-label="Progress totals">
      <div class="stat-card">
        <span class="stat-value">{cockpit.progress.tasks.completed}<span class="stat-suffix">/{cockpit.progress.tasks.total}</span></span>
        <span class="stat-label">tasks</span>
        <span class="stat-pct">{pctText(cockpit.progress.tasks.pct)}</span>
      </div>
      <div class="stat-card" class:soft={cockpit.progress.phases.length === 0}>
        {#if cockpit.progress.phases.length === 0}
          <span class="stat-value muted">—</span>
          <span class="stat-label">phases</span>
          <span class="stat-pct">none yet</span>
        {:else}
          <span class="stat-value">{cockpit.progress.phases.length}</span>
          <span class="stat-label">phases</span>
          <span class="stat-pct">{cockpit.progress.phases.filter((entry) => entry.pct >= 1).length} done</span>
        {/if}
      </div>
      <div class="stat-card" class:soft={cockpit.progress.milestones.total === 0}>
        {#if cockpit.progress.milestones.total === 0}
          <span class="stat-value muted">—</span>
          <span class="stat-label">milestones</span>
          <span class="stat-pct">none yet</span>
        {:else}
          <span class="stat-value">{cockpit.progress.milestones.completed}<span class="stat-suffix">/{cockpit.progress.milestones.total}</span></span>
          <span class="stat-label">milestones</span>
          <span class="stat-pct">{pctText(cockpit.progress.milestones.pct)}</span>
        {/if}
      </div>
      <div class="stat-card">
        <span class="stat-value">{cockpit.unphasedTasks.length}</span>
        <span class="stat-label">unphased</span>
      </div>
    </section>

    {#if cockpit.progress.phases.length > 0}
      <section class="cockpit-section" aria-label="Phase progress">
        <h3>Phases</h3>
        <ul class="phase-list">
          {#each cockpit.progress.phases as phase (`phase:${phase.id}`)}
            <li class="phase-row">
              <span class="phase-title">{phase.title}</span>
              <span class="phase-bar" aria-hidden="true">
                <span class="phase-bar-fill" style="width: {Math.round(phase.pct * 100)}%"></span>
              </span>
              <span class="phase-pct">{Math.round(phase.pct * 100)}%</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <PlanCockpitUnphased unphasedTasks={cockpit.unphasedTasks} {onSelectTask} />

    {#if (cockpit.rooms?.length ?? 0) > 0}
      <section class="cockpit-section" aria-label="Attached rooms">
        <h3>Rooms</h3>
        <ul class="room-list">
          {#each cockpit.rooms as room (`room:${room.roomId}`)}
            <li class="room-row">
              <a class="room-link" href={`/rooms/${encodeURIComponent(room.roomId)}`}>{room.name}</a>
              <span class="muted">attached {new Date(room.attachedAtMs).toLocaleDateString()}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if (cockpit.recentActivity?.length ?? 0) > 0}
      <section class="cockpit-section" aria-label="Recent activity">
        <h3>Recent activity</h3>
        <ul class="activity-list">
          {#each cockpit.recentActivity as entry (`activity:${entry.kind}:${entry.refId}:${entry.atMs}`)}
            <li class="activity-row">
              <span class="activity-kind">{entry.kind}</span>
              <span class="activity-summary">{entry.title ?? entry.refId}</span>
              <span class="muted">{new Date(entry.atMs).toLocaleString()}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>

<style>
  .plan-cockpit {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 1.1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--surface);
  }
  .cockpit-loading {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cockpit-loading .cockpit-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.55rem;
  }
  .cockpit-loading .stat-card {
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    background: var(--bg);
  }
  .cockpit-header { display: flex; flex-direction: column; gap: 0.3rem; }
  .cockpit-title-row { display: flex; align-items: baseline; gap: 0.65rem; }
  h2 { margin: 0; font-size: 1.4rem; color: var(--ink-strong); }
  .lifecycle {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    color: var(--ink-soft);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 800;
  }
  .lifecycle.lifecycle-active { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  /* #136c live freshness pill — sits alongside the lifecycle chip so
     operators see "Live · updated 12s ago" without leaving the cockpit.
     Pulses while a background refresh is in flight; goes static the rest
     of the time so the eye doesn't track an idle dot. */
  .freshness-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.55rem;
    margin-left: auto;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ok) 10%, var(--surface-card));
    border: 1px solid color-mix(in srgb, var(--ok) 30%, var(--line-soft));
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .freshness-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--ok);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok) 25%, transparent);
  }
  .freshness-pill.is-refreshing .freshness-dot {
    animation: freshness-refresh-pulse 0.9s ease-in-out infinite;
  }
  @keyframes freshness-refresh-pulse {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok) 25%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ok) 0%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .freshness-pill.is-refreshing .freshness-dot {
      animation: none;
    }
  }
  .cockpit-description { margin: 0; color: var(--ink-soft); font-size: 0.92rem; }
  .cockpit-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.55rem;
  }
  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    background: var(--bg);
  }
  /* #168 zero-state: phases or milestones that haven't been populated
     yet render with a muted em-dash + "none yet" instead of a hard
     "0/0" that reads as a failure. */
  .stat-card.soft {
    border-style: dashed;
    opacity: 0.78;
  }
  .stat-value.muted {
    color: var(--ink-soft);
    font-weight: 700;
  }
  .stat-value {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--accent);
    line-height: 1.05;
  }
  .stat-suffix { font-size: 0.85rem; color: var(--ink-soft); font-weight: 500; }
  .stat-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .stat-pct { font-size: 0.74rem; color: var(--ink-soft); }
  .cockpit-section { display: flex; flex-direction: column; gap: 0.4rem; }
  .cockpit-section h3 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .phase-list, .room-list, .activity-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .phase-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.85rem;
  }
  .phase-title { flex: 0 0 30%; color: var(--ink-strong); }
  .phase-bar { flex: 1; height: 0.45rem; border-radius: 999px; background: var(--surface-edge); overflow: hidden; }
  .phase-bar-fill { display: block; height: 100%; background: var(--accent); }
  .phase-pct { width: 3rem; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-soft); }
  .room-row { display: flex; align-items: baseline; gap: 0.5rem; font-size: 0.85rem; }
  .room-link { color: var(--accent); text-decoration: none; }
  .room-link:hover { text-decoration: underline; }
  .activity-row { display: flex; gap: 0.55rem; align-items: baseline; font-size: 0.82rem; }
  .activity-kind {
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.7rem;
    text-transform: uppercase;
  }
  .activity-summary { flex: 1; color: var(--ink-strong); }
  .muted { margin: 0; color: var(--ink-soft); font-size: 0.78rem; }
  .cockpit-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--warn) 14%, var(--surface-card));
    color: var(--ink-strong);
    flex-wrap: wrap;
  }
  .cockpit-error .error-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 12rem;
  }
  .cockpit-error .error-text strong { font-size: 0.95rem; }
  .cockpit-error .error-detail { color: var(--ink-soft); font-size: 0.82rem; }
  .cockpit-error .error-retry {
    padding: 0.4rem 0.95rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .cockpit-error .error-retry:hover { filter: brightness(1.05); }
</style>
