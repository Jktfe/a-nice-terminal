<!--
  PlanDonutCard — L1 plans-index card (Lane-D S2). A completion donut
  (completed/total task ratio) + label. Pure SVG ring, no library.
  Links through to the per-plan Gantt unless `href` is omitted (the
  "Unfiled" standalone-task lane is a card but not a plan donut target).
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  type Props = {
    label: string;
    total: number;
    completed: number;
    pct: number;
    href?: string;
    /** Plan id — needed when the card exposes the hard-delete affordance.
     *  Omit for the Unfiled card / aggregate cards that have no plan. */
    planId?: string;
    /** Show the per-card hard-delete affordance (2-click arm→commit).
     *  Wired on /plans?show=archived + /plans?show=deleted views only —
     *  JWPK msg_mpdr8q9p43 + coordinator msg_s225thcwia spec. */
    showHardDelete?: boolean;
    /**
     * Show the per-card lifecycle chooser (Archive · Permanently delete ·
     * Cancel) on active plans — JWPK msg_zcsmyfk7e2 (2026-05-26). Active
     * plans need a delete that asks WHICH (archive=recoverable vs hard).
     * Wired on /plans default view only. Archived/deleted views keep the
     * existing showHardDelete arm→commit shape.
     */
    showLifecycleActions?: boolean;
  };
  let { label, total, completed, pct, href, planId, showHardDelete = false, showLifecycleActions = false }: Props = $props();

  type DeleteState = 'idle' | 'armed' | 'committing' | 'error';
  let deleteState = $state<DeleteState>('idle');
  let errorMessage = $state('');
  let disarmTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle chooser (active plans, JWPK 2026-05-26) ───────────
  type LifecycleState = 'idle' | 'chooser' | 'committing' | 'error';
  let lifecycleState = $state<LifecycleState>('idle');
  let lifecycleErrorMessage = $state('');
  let lifecycleCommittingLabel = $state('');

  function clearDisarmTimer() {
    if (disarmTimer !== null) {
      clearTimeout(disarmTimer);
      disarmTimer = null;
    }
  }

  function armDelete() {
    deleteState = 'armed';
    errorMessage = '';
    clearDisarmTimer();
    // 5s arm window — same UX as message-delete 2cd2c64. Long enough to
    // think, short enough that a misclick doesn't sit dangerous on screen.
    disarmTimer = setTimeout(() => {
      if (deleteState === 'armed') deleteState = 'idle';
    }, 5_000);
  }

  async function commitDelete() {
    if (!planId) return;
    clearDisarmTimer();
    deleteState = 'committing';
    errorMessage = '';
    try {
      // Coordinator shipped PATCH /api/plans/:id { action: "hard-delete" }
      // (commit 1ab15e0). Admin-bearer-gated; we proxy through a
      // browser-session SvelteKit form action so the operator's session
      // cookie is what the server checks, not a client-held admin token.
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'hard-delete' })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        if (response.status === 404) {
          errorMessage = 'Plan not found (already deleted?).';
        } else if (response.status === 401 || response.status === 403) {
          errorMessage = 'Not authorised — auth gap pending coordinator follow-up.';
        } else {
          errorMessage = failure.message ?? `Delete failed (${response.status}).`;
        }
        deleteState = 'error';
        return;
      }
      // Refresh the page data so the deleted card animates out via the
      // parent re-render. Response carries cascadeCount which we drop
      // for now — could surface as a toast in a follow-up.
      await invalidateAll();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Delete failed.';
      deleteState = 'error';
    }
  }

  function cancelArmed() {
    clearDisarmTimer();
    deleteState = 'idle';
    errorMessage = '';
  }

  function openLifecycleChooser() {
    lifecycleState = 'chooser';
    lifecycleErrorMessage = '';
  }

  function cancelLifecycle() {
    lifecycleState = 'idle';
    lifecycleErrorMessage = '';
    lifecycleCommittingLabel = '';
  }

  async function commitLifecycleAction(action: 'archive' | 'hard-delete') {
    if (!planId) return;
    lifecycleCommittingLabel = action === 'archive' ? 'Archiving' : 'Deleting';
    lifecycleState = 'committing';
    lifecycleErrorMessage = '';
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        if (response.status === 404) {
          lifecycleErrorMessage = 'Plan not found.';
        } else if (response.status === 401 || response.status === 403) {
          lifecycleErrorMessage = 'Not authorised.';
        } else {
          lifecycleErrorMessage = failure.message ?? `${action} failed (${response.status}).`;
        }
        lifecycleState = 'error';
        return;
      }
      await invalidateAll();
    } catch (cause) {
      lifecycleErrorMessage = cause instanceof Error ? cause.message : `${action} failed.`;
      lifecycleState = 'error';
    }
  }

  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = $derived(`${Math.max(0, Math.min(1, pct)) * C} ${C}`);
  const pctText = $derived(total === 0 ? '—' : `${Math.round(pct * 100)}%`);
  // Tint the donut ring by completion bucket so a plans-index scan
  // surfaces "behind / on-track / done" at a glance. The buckets are
  // tuned to the same thresholds the Gantt and Cockpit use for the
  // attention rules: <30% = warn, 30–70% = info, ≥70% = ok, =1 = accent.
  const ringTint = $derived.by(() => {
    if (total === 0) return 'var(--line-soft)';
    if (pct >= 1) return 'var(--ok)';
    if (pct >= 0.7) return 'var(--ok)';
    if (pct >= 0.3) return 'var(--info)';
    return 'var(--warn)';
  });
</script>

{#snippet body()}
  <svg viewBox="0 0 64 64" class="ring" aria-hidden="true">
    <circle cx="32" cy="32" r={R} class="track" />
    <circle
      cx="32"
      cy="32"
      r={R}
      class="fill"
      stroke-dasharray={dash}
      transform="rotate(-90 32 32)"
      style:stroke={ringTint}
    />
    <text x="32" y="36" class="pct">{pctText}</text>
  </svg>
  <div class="meta">
    <strong class="label" title={label}>{label}</strong>
    <span class="count">{completed}/{total} tasks done</span>
  </div>
{/snippet}

{#snippet deleteAffordance()}
  {#if showHardDelete && planId}
    <div class="hard-delete-bar" data-delete-state={deleteState}>
      {#if deleteState === 'idle'}
        <button
          type="button"
          class="hard-delete-arm"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); armDelete(); }}
          title="Permanently delete this plan + all its tasks"
          aria-label={`Delete plan "${label}" permanently`}
        >Delete permanently</button>
      {:else if deleteState === 'armed'}
        <button
          type="button"
          class="hard-delete-commit"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); void commitDelete(); }}
          title="Click again to permanently delete (auto-cancels in 5s)"
          aria-label={`Confirm permanent delete of plan "${label}"`}
        >Click again to confirm</button>
        <button
          type="button"
          class="hard-delete-cancel"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); cancelArmed(); }}
          aria-label="Cancel delete"
        >Cancel</button>
      {:else if deleteState === 'committing'}
        <span class="hard-delete-status" aria-live="polite">Deleting…</span>
      {:else if deleteState === 'error'}
        <span class="hard-delete-error" role="alert" title={errorMessage}>{errorMessage}</span>
        <button
          type="button"
          class="hard-delete-cancel"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); cancelArmed(); }}
        >Dismiss</button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet lifecycleAffordance()}
  {#if showLifecycleActions && planId}
    <div class="lifecycle-bar" data-lifecycle-state={lifecycleState}>
      {#if lifecycleState === 'idle'}
        <button
          type="button"
          class="lifecycle-trigger"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); openLifecycleChooser(); }}
          aria-label={`Delete or archive plan "${label}"`}
          title="Archive or permanently delete this plan"
        >Delete…</button>
      {:else if lifecycleState === 'chooser'}
        <span class="lifecycle-prompt">Archive or delete?</span>
        <button
          type="button"
          class="lifecycle-archive"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); void commitLifecycleAction('archive'); }}
          title="Move to archive — recoverable via /plans?show=archived"
        >Archive</button>
        <button
          type="button"
          class="lifecycle-hard"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); void commitLifecycleAction('hard-delete'); }}
          title="Permanently delete — cannot be undone"
        >Permanently delete</button>
        <button
          type="button"
          class="lifecycle-cancel"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); cancelLifecycle(); }}
        >Cancel</button>
      {:else if lifecycleState === 'committing'}
        <span class="lifecycle-status" aria-live="polite">{lifecycleCommittingLabel}…</span>
      {:else if lifecycleState === 'error'}
        <span class="lifecycle-error" role="alert" title={lifecycleErrorMessage}>{lifecycleErrorMessage}</span>
        <button
          type="button"
          class="lifecycle-cancel"
          onclick={(e) => { e.preventDefault(); e.stopPropagation(); cancelLifecycle(); }}
        >Dismiss</button>
      {/if}
    </div>
  {/if}
{/snippet}

{#if href}
  <div class="card-wrap" data-plan={label}>
    <a class="card" {href}>{@render body()}</a>
    {@render deleteAffordance()}
    {@render lifecycleAffordance()}
  </div>
{:else}
  <div class="card-wrap" data-plan={label}>
    <div class="card static">{@render body()}</div>
    {@render deleteAffordance()}
    {@render lifecycleAffordance()}
  </div>
{/if}

<style>
  .card {
    display: flex; align-items: center; gap: 1.1rem;
    padding: 1.1rem 1.25rem; text-decoration: none;
    background: var(--surface-card); color: var(--ink-strong);
    border: 1px solid var(--line-soft); border-radius: 0.85rem;
  }
  a.card:hover { border-color: var(--accent); }
  .card.static { opacity: 0.92; }
  /* JWPK msg_bqc6c742f8 screenshot annotation: donut should be larger
     in the card. Bumped from 3.4rem → 5.5rem so the completion ratio
     is the visual anchor of the card rather than a small badge to the
     left of the label. Stroke widths bumped proportionally so the ring
     keeps its weight at the new size. */
  .ring { width: 5.5rem; height: 5.5rem; flex: 0 0 auto; }
  /* JWPK plan-card-polish ("chunky donut") — bumped stroke 6 → 8 so
     the ring reads as a substantial completion gauge at the 5.5rem
     card size rather than a thin trace. Slight font bump on the
     centred % follows so the digits still anchor the donut. */
  .track { fill: none; stroke: var(--line-soft); stroke-width: 8; }
  .fill {
    fill: none; stroke: var(--accent); stroke-width: 8;
    stroke-linecap: round; transition: stroke-dasharray 0.3s ease;
  }
  .pct {
    font-size: 1.05rem; font-weight: 800; fill: var(--ink-strong);
    text-anchor: middle;
  }
  .meta { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .label {
    font-size: 1rem; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; max-width: 14rem;
  }
  .count { color: var(--ink-soft); font-size: 0.82rem; }

  /* Hard-delete affordance (JWPK msg_mpdr8q9p43 + coord msg_s225thcwia).
     Sits as a thin bar BELOW the card so the click target doesn't fight
     the card's anchor for clicks. arm→commit→done UX same as message
     row delete 2cd2c64. */
  .card-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .hard-delete-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.78rem;
  }
  .hard-delete-arm {
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    border: 1px dashed color-mix(in srgb, var(--warn, #c92020) 35%, var(--line-soft));
    background: transparent;
    color: var(--ink-soft);
    font-weight: 700;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .hard-delete-arm:hover {
    color: var(--warn, #c92020);
    border-color: var(--warn, #c92020);
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
  }
  .hard-delete-commit {
    padding: 0.3rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--warn, #c92020);
    background: var(--warn, #c92020);
    color: white;
    font-weight: 800;
    cursor: pointer;
    animation: hard-delete-pulse 1.1s ease-in-out infinite;
  }
  @keyframes hard-delete-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn, #c92020) 30%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--warn, #c92020) 0%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .hard-delete-commit { animation: none; }
  }
  .hard-delete-cancel {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
    color: var(--ink-strong);
    font-weight: 700;
    cursor: pointer;
  }
  .hard-delete-status {
    color: var(--ink-soft);
    font-weight: 700;
    font-style: italic;
  }
  .hard-delete-error {
    color: var(--warn, #c92020);
    font-weight: 700;
    max-width: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Lifecycle chooser (JWPK msg_zcsmyfk7e2 2026-05-26) — active-plan
     affordance offering Archive vs Permanent delete. Same bar slot as
     hard-delete-bar; idle state is a quiet button, chooser state inlines
     three labelled choices so an operator can pick destructive-vs-soft
     without a separate modal. */
  .lifecycle-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.78rem;
    flex-wrap: wrap;
  }
  .lifecycle-trigger {
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-soft);
    font-weight: 700;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .lifecycle-trigger:hover {
    color: var(--ink-strong);
    border-color: var(--accent);
    background: var(--surface-raised);
  }
  .lifecycle-prompt {
    color: var(--ink-soft);
    font-weight: 700;
    margin-right: 0.2rem;
  }
  .lifecycle-archive {
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--info, #3a72c9);
    background: transparent;
    color: var(--info, #3a72c9);
    font-weight: 700;
    cursor: pointer;
  }
  .lifecycle-archive:hover {
    background: color-mix(in srgb, var(--info, #3a72c9) 10%, transparent);
  }
  .lifecycle-hard {
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--warn, #c92020);
    background: var(--warn, #c92020);
    color: white;
    font-weight: 800;
    cursor: pointer;
  }
  .lifecycle-cancel {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
    color: var(--ink-strong);
    font-weight: 700;
    cursor: pointer;
  }
  .lifecycle-status {
    color: var(--ink-soft);
    font-weight: 700;
    font-style: italic;
  }
  .lifecycle-error {
    color: var(--warn, #c92020);
    font-weight: 700;
    max-width: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
