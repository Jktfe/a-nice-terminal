<!--
  ClaimValidationOverlay — Stage v2 per-claim verifier runs overlay.
  Shows validation history for a single claim anchor + status badge.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type ValidationRun = {
    id: string;
    schemaId: string;
    claimAnchor: string;
    claimText: string;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'waived';
    score: number | null;
    resultJson: string | null;
    startedAtMs: number;
    completedAtMs: number | null;
    runBy: string | null;
  };

  type Props = {
    claimIndex: number;
    claimAnchor: string;
    claimText: string;
    onClose: () => void;
  };

  let { claimIndex, claimAnchor, claimText, onClose }: Props = $props();

  let runs = $state<ValidationRun[]>([]);
  let loading = $state(false);
  let errorMsg = $state('');

  async function loadRuns() {
    loading = true;
    errorMsg = '';
    try {
      const res = await fetch(`/api/validation-runs/by-claim?claimAnchor=${encodeURIComponent(claimAnchor)}`);
      if (!res.ok) {
        errorMsg = `HTTP ${res.status}`;
        return;
      }
      const data = await res.json();
      runs = data.runs ?? [];
    } catch {
      errorMsg = 'Network error';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadRuns();
  });

  function statusBadge(status: string): string {
    switch (status) {
      case 'passed': return '✓ Passed';
      case 'failed': return '✗ Failed';
      case 'pending': return '⏳ Pending';
      case 'running': return '⟳ Running';
      case 'waived': return '− Waived';
      default: return status;
    }
  }

  function statusClass(status: string): string {
    return `status-${status}`;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="overlay-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()} tabindex="-1" role="presentation">
  <div class="overlay-panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} tabindex="0" role="dialog" aria-label={`Validation for Claim ${claimIndex}`}>
    <header class="overlay-header">
      <span class="claim-label">Claim {claimIndex}</span>
      <span class="claim-anchor">{claimAnchor}</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close overlay">✕</button>
    </header>

    <p class="claim-text">{claimText}</p>

    {#if loading}
      <p class="loading">Loading validation runs…</p>
    {:else if errorMsg}
      <p class="error">{errorMsg}</p>
    {:else if runs.length === 0}
      <div class="empty-state">
        <p>No validation runs yet for this claim.</p>
        <p class="hint">Validation runs are created when you assign a verifier task to an agent or run an automated check.</p>
      </div>
    {:else}
      <ul class="runs-list" aria-label="Validation runs">
        {#each runs as run}
          <li class="run-row">
            <span class={`status-badge ${statusClass(run.status)}`}>{statusBadge(run.status)}</span>
            <span class="run-meta">
              {#if run.score !== null}>
                <span class="score">Score {Math.round(run.score * 100)}%</span>
              {/if}
              <span class="run-by">{run.runBy ?? 'System'}</span>
              <span class="timestamp">{new Date(run.startedAtMs).toLocaleString()}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .overlay-backdrop {
    position: fixed; inset: 0; z-index: 9998;
    background: rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .overlay-panel {
    width: 100%; max-width: 28rem;
    padding: 1rem 1.2rem;
    background: var(--surface-raised);
    border: 1px solid var(--line-soft);
    border-radius: 0.7rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  }
  .overlay-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 0.6rem;
  }
  .claim-label { font-weight: 800; font-size: 0.9rem; color: var(--accent); }
  .claim-anchor {
    margin-left: 0.45rem;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.68rem;
    font-weight: 750;
  }
  .close-btn {
    padding: 0.2rem 0.5rem; border: none; background: transparent;
    color: var(--ink-soft); font-size: 1.1rem; cursor: pointer; border-radius: 0.3rem;
  }
  .close-btn:hover { color: var(--ink-strong); background: var(--surface-card); }
  .claim-text { margin: 0 0 1rem; font-size: 0.92rem; line-height: 1.4; color: var(--ink-strong); }
  .loading, .error { margin: 0.5rem 0; font-size: 0.85rem; }
  .error { color: var(--warn); }
  .empty-state { padding: 0.8rem; border: 1px dashed var(--line-soft); border-radius: 0.5rem; }
  .empty-state p { margin: 0; font-size: 0.85rem; color: var(--ink-soft); }
  .empty-state .hint { margin-top: 0.35rem; font-size: 0.8rem; color: var(--ink-muted); }
  .runs-list { list-style: none; margin: 0; padding: 0; }
  .run-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0; border-bottom: 1px solid var(--line-soft);
  }
  .run-row:last-child { border-bottom: none; }
  .status-badge {
    padding: 0.15rem 0.5rem; border-radius: 0.35rem;
    font-size: 0.78rem; font-weight: 700;
  }
  .status-passed { background: #e8f5e9; color: #2e7d32; }
  .status-failed { background: #ffebee; color: #c62828; }
  .status-pending { background: #fff8e1; color: #f57f17; }
  .status-running { background: #e3f2fd; color: #1565c0; }
  .status-waived { background: #f5f5f5; color: #616161; }
  .run-meta { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--ink-soft); }
  .score { font-weight: 700; color: var(--accent); }
  .run-by { font-style: italic; }
  .timestamp { font-variant-numeric: tabular-nums; }
</style>
