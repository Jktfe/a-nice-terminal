<!--
  /diagnostics — operator trust surface (B2-8 parity).
  Exposes /api/health + /api/diagnostics/summary in a readable grid.
  No admin auth required for this page — the summary endpoint is public.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import type { DiagnosticsSummary, HealthData } from './+page';

  type Props = {
    data: {
      health: HealthData | null;
      summary: DiagnosticsSummary | null;
    };
  };

  let { data }: Props = $props();

  const health = $derived(data.health);
  const summary = $derived(data.summary);

  function fmtTime(seconds: number | undefined): string {
    if (seconds == null) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }
</script>

<SimplePageShell eyebrow="Operator" title="Diagnostics" summary="Runtime health, DB size, SSE state, and recent errors.">
  {#if !summary}
    <p class="error-nudge">Diagnostics summary unavailable. Check that the server is running.</p>
  {:else}
  <Explainable explainKey="diagnostics-content">
  <section class="diag-grid">
      <div class="diag-card">
        <h2>Process</h2>
        <p>Status: <span class="status-pill" data-state={summary.status}>{summary.status}</span></p>
        <p>PID: {summary.pid}</p>
        <p>Uptime: {fmtTime(summary.uptimeSeconds)}</p>
        <p>Node: {summary.nodeVersion}</p>
      </div>

      <div class="diag-card">
        <h2>Database</h2>
        <p>Path: <code>{summary.db?.path}</code></p>
        <p>Main: {summary.db?.mainSize} ({summary.db?.mainBytes?.toLocaleString()} bytes)</p>
        <p>WAL: {summary.db?.walSize} ({summary.db?.walBytes?.toLocaleString()} bytes)</p>
        <p>SHM: {summary.db?.shmSize}</p>
        <p>Reachable: {summary.db?.reachable ? 'yes' : 'no'}</p>
      </div>

      <div class="diag-card">
        <h2>SSE Subscribers</h2>
        <p>Total: {summary.sse?.totalSubscribers ?? 0}</p>
        {#if summary.sse?.rooms?.length > 0}
          <ul>
            {#each summary.sse.rooms as r}
              <li>{r.roomName}: {r.count}</li>
            {/each}
          </ul>
        {:else}
          <p class="empty">No active room subscribers.</p>
        {/if}
      </div>

      <div class="diag-card">
        <h2>CLI Hook Lag</h2>
        {#if summary.cliHookLag?.sampleCount > 0}
          <p>Latest: {summary.cliHookLag.latestSec}s</p>
          <p>p50: {summary.cliHookLag.p50Sec}s</p>
          <p>p99: {summary.cliHookLag.p99Sec}s</p>
          <p class="empty">Sample: {summary.cliHookLag.sampleCount} events</p>
        {:else}
          <p class="empty">No hook events recorded.</p>
        {/if}
      </div>

      <div class="diag-card wide">
        <h2>Recent 500s</h2>
        <p>All-time: {summary.log500s?.allTime ?? 0} | Last 1000 lines: {summary.log500s?.recent ?? 0}</p>
        {#if summary.log500s?.latest}
          <p><code>{summary.log500s.latest}</code></p>
        {:else}
          <p class="empty">No 500s in log.</p>
        {/if}
      </div>

      <div class="diag-card wide">
        <h2>Boot Flags</h2>
        <ul class="flag-list">
          {#each Object.entries(summary.booted ?? {}) as [flag, ok]}
            <li class={ok ? 'ok' : 'missing'}>{flag}: {ok ? 'yes' : 'no'}</li>
          {/each}
        </ul>
      </div>
    </section>
  </Explainable>
  {/if}

  {#if health}
    <section class="diag-section">
      <h2>Health Detail</h2>
      <pre>{JSON.stringify(health, null, 2)}</pre>
    </section>
  {/if}
</SimplePageShell>

<style>
  /* Swapped non-existent --color-* placeholders for the actual design
     tokens (--surface-card / --line-soft / --ink-soft / --ok / --warn)
     so the page renders cleanly in both light + dark mode and matches
     the rest of the app's visual language. Hardcoded light-mode hex
     values on status pills + error nudges replaced with color-mix
     against the semantic tokens. */
  .diag-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.9rem;
    margin-top: 1rem;
  }
  .diag-card {
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    padding: 1rem 1.1rem;
    background: var(--surface-card);
  }
  .diag-card.wide {
    grid-column: 1 / -1;
  }
  .diag-card h2 {
    font-size: 0.78rem;
    margin: 0 0 0.6rem;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
  }
  .diag-card p, .diag-card li {
    margin: 0.25rem 0;
    font-size: 0.9rem;
    color: var(--ink-strong);
  }
  .diag-card code {
    font-size: 0.78rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    word-break: break-all;
    color: var(--ink-soft);
  }
  .status-pill {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid transparent;
  }
  .status-pill[data-state="ok"] {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 32%, transparent);
  }
  .status-pill[data-state="degraded"] {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 32%, transparent);
  }
  .empty {
    color: var(--ink-muted);
    font-style: italic;
    font-size: 0.85rem;
  }
  .error-nudge {
    color: var(--ink-strong);
    padding: 0.9rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--warn) 16%, var(--surface-card));
  }
  .flag-list {
    list-style: none;
    padding: 0;
    margin: 0;
    columns: 2;
  }
  .flag-list li {
    font-size: 0.78rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    padding: 0.1rem 0;
  }
  .flag-list li.ok { color: var(--ok); }
  .flag-list li.missing { color: var(--warn); }
  .diag-section {
    margin-top: 2rem;
  }
  .diag-section h2 {
    font-size: 0.78rem;
    margin: 0 0 0.6rem;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
  }
  .diag-section pre {
    margin: 0;
    font-size: 0.78rem;
    overflow-x: auto;
    background: var(--bg);
    color: var(--ink-strong);
    padding: 1rem 1.1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
