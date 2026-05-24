<!--
  PlanOverallDonut — aggregate completion donut for the /plans header
  (JWPK msg_iuspae79e0 2026-05-24). Non-clickable, purely visual: "yo
  this is where all the plans are at" at a glance.

  Sums completed/total across every active plan + the Unfiled lane on
  the index page. Same SVG ring shape as PlanDonutCard but bigger, no
  delete affordances, no link, no plan-id.

  Compact horizontal strip: large donut on the left, label + counts +
  pct on the right.
-->
<script lang="ts">
  type Props = {
    total: number;
    completed: number;
    /** How many distinct plans rolled up into the aggregate (excluding
     *  Unfiled if it's empty). Surfaced as a small subtitle so the donut
     *  doesn't feel context-free. Pass 0 to hide the plan-count line. */
    planCount?: number;
  };
  let { total, completed, planCount = 0 }: Props = $props();

  // Defensive clamps — division-by-zero on a fresh workspace renders
  // 0% rather than NaN%; pct beyond [0,1] gets coerced so the
  // stroke-dasharray maths stays in the ring.
  const safeTotal = $derived(Math.max(0, total));
  const safeCompleted = $derived(Math.max(0, Math.min(completed, safeTotal)));
  const pct = $derived(safeTotal === 0 ? 0 : safeCompleted / safeTotal);
  const pctLabel = $derived(`${Math.round(pct * 100)}%`);

  // SVG ring geometry — radius 36, viewBox 100x100, stroke width 16.
  // Circumference = 2πr ≈ 226. dasharray applies the progress fraction.
  const CIRCUMFERENCE = 2 * Math.PI * 36;
  const dash = $derived(`${pct * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
</script>

<aside class="overall-donut" aria-label="Aggregate plans completion">
  <svg
    class="ring"
    viewBox="0 0 100 100"
    role="img"
    aria-label="{pctLabel} complete across {safeCompleted} of {safeTotal} tasks"
  >
    <!-- Track ring (full circle, muted) -->
    <circle cx="50" cy="50" r="36" class="track" />
    <!-- Progress ring — rotated -90° so the dasharray starts at 12 o'clock -->
    <circle
      cx="50" cy="50" r="36"
      class="progress"
      style:stroke-dasharray={dash}
      transform="rotate(-90 50 50)"
    />
    <!-- Centre label -->
    <text x="50" y="55" text-anchor="middle" class="centre-label">{pctLabel}</text>
  </svg>
  <div class="caption">
    <strong>Overall</strong>
    <span class="counts">{safeCompleted} of {safeTotal} task{safeTotal === 1 ? '' : 's'} complete</span>
    {#if planCount > 0}
      <span class="plan-count">across {planCount} plan{planCount === 1 ? '' : 's'}</span>
    {/if}
  </div>
</aside>

<style>
  .overall-donut {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    margin: 0 0 0.9rem;
  }
  .ring {
    width: 4.5rem;
    height: 4.5rem;
    flex-shrink: 0;
  }
  .track {
    fill: none;
    stroke: var(--surface-raised, #f1f5f9);
    stroke-width: 16;
  }
  .progress {
    fill: none;
    stroke: var(--accent, #6b21a8);
    stroke-width: 16;
    stroke-linecap: butt;
    transition: stroke-dasharray 250ms ease-out;
  }
  .centre-label {
    fill: var(--ink-strong, #0f172a);
    font: 700 22px/1 ui-sans-serif, system-ui, sans-serif;
  }
  .caption {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .caption strong {
    font: 800 1rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .counts {
    font: 500 0.85rem/1.3 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-soft, #475569);
  }
  .plan-count {
    font: 500 0.78rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #94a3b8);
  }
</style>
