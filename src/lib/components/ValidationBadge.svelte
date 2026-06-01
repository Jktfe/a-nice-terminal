<!--
  ValidationBadge — lens-aware status badge for claims/tasks.
  
  Props:
    taskId: string — the validation task ID that scopes the lookup to a room
    compact?: boolean — if true, shows only icon + color dot
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type ValidationRun = {
    status: 'pending' | 'running' | 'passed' | 'failed' | 'waived';
    score: number | null;
    lensKind: string;
    completedAtMs: number | null;
  };

  type Props = {
    taskId: string;
    compact?: boolean;
  };

  let { taskId, compact = false }: Props = $props();

  let run = $state<ValidationRun | null>(null);
  let loading = $state(true);

  const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
    pending:   { label: 'Pending',   color: '#9ca3af', icon: '⏳' },
    running:   { label: 'Running',   color: '#3b82f6', icon: '🔍' },
    passed:    { label: 'Passed',    color: '#22c55e', icon: '✓' },
    failed:    { label: 'Failed',    color: '#ef4444', icon: '✕' },
    waived:    { label: 'Waived',    color: '#a855f7', icon: '—' },
  };

  async function loadRun() {
    loading = true;
    try {
      const res = await fetch(`/api/validation-runs?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) return;
      const data = await res.json() as { runs: ValidationRun[] };
      run = data.runs?.[0] ?? null;
    } catch { /* silent */ }
    finally { loading = false; }
  }

  onMount(() => { void loadRun(); });

  const meta = $derived(run ? STATUS_META[run.status] ?? STATUS_META.pending : null);
</script>

{#if !loading && run && meta}
  {#if compact}
    <span class="badge-compact" style="background:{meta.color}" title="{meta.label} — {run.lensKind}{run.score != null ? ` · ${run.score}` : ''}"></span>
  {:else}
    <span class="badge" style="border-color:{meta.color}; color:{meta.color}">
      <span class="icon">{meta.icon}</span>
      <span class="label">{meta.label}</span>
      {#if run.score != null}
        <span class="score">{run.score}</span>
      {/if}
      <span class="lens">{run.lensKind}</span>
    </span>
  {/if}
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border: 1px solid;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    background: transparent;
    white-space: nowrap;
  }
  .icon { font-size: 0.7rem; }
  .label { text-transform: capitalize; }
  .score {
    padding: 0 0.2rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 0.25rem;
    font-variant-numeric: tabular-nums;
  }
  .lens {
    opacity: 0.7;
    font-weight: 500;
    font-size: 0.7rem;
  }
  .badge-compact {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
</style>
