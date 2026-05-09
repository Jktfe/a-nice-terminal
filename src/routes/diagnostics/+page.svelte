<!--
  Speed diagnostics — opens a real chat-room load against the live
  server and reports per-endpoint + total wall-clock so we can stop
  asking "does it feel slow" and look at numbers.

  Owned by mobile-ant-recovery-2026-05-09 — read it on Safari to
  capture mobile-network reality, not just the localhost happy path.

  No measurement is shipped to the server. Everything stays in the
  browser, viewable + copyable. Safe to deploy in production.
-->

<script lang="ts">
  import { onMount } from 'svelte';

  type EndpointResult = {
    label: string;
    url: string;
    ok: boolean;
    status: number;
    ttfbMs: number | null;
    totalMs: number;
    bytes: number;
    error?: string;
  };

  let sessionInput = $state('');
  let running = $state(false);
  let results = $state<EndpointResult[]>([]);
  let totalMs = $state<number | null>(null);
  let userAgent = $state('');
  let viewport = $state<{ w: number; h: number; dpr: number } | null>(null);
  let serviceWorker = $state<{ controlled: boolean; scope?: string } | null>(null);
  let networkInfo = $state<{ effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } | null>(null);

  onMount(async () => {
    if (typeof navigator !== 'undefined') {
      userAgent = navigator.userAgent;
    }
    if (typeof window !== 'undefined') {
      viewport = {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      };
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      serviceWorker = {
        controlled: !!navigator.serviceWorker.controller,
        scope: reg?.scope,
      };
    }
    // Network Information API — Chrome/Firefox; Safari may not implement.
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection;
    if (conn) {
      networkInfo = {
        effectiveType: conn.effectiveType,
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: conn.saveData,
      };
    }

    // Pre-fill with the most recent session id from localStorage if present.
    if (typeof window !== 'undefined') {
      const last = window.localStorage.getItem('ant.diagnostics.lastSessionId') || '';
      if (last) sessionInput = last;
    }
  });

  async function timeFetch(label: string, url: string): Promise<EndpointResult> {
    const start = performance.now();
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const totalElapsed = performance.now() - start;
      // PerformanceResourceTiming gives us TTFB if available.
      let ttfbMs: number | null = null;
      const entries = performance.getEntriesByName(new URL(url, location.origin).href, 'resource');
      const last = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
      if (last) {
        ttfbMs = last.responseStart - last.requestStart;
      }
      return {
        label,
        url,
        ok: res.ok,
        status: res.status,
        ttfbMs,
        totalMs: totalElapsed,
        bytes: buf.byteLength,
      };
    } catch (err) {
      const totalElapsed = performance.now() - start;
      return {
        label,
        url,
        ok: false,
        status: 0,
        ttfbMs: null,
        totalMs: totalElapsed,
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function run() {
    const sessionId = sessionInput.trim();
    if (!sessionId) return;
    running = true;
    results = [];
    totalMs = null;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ant.diagnostics.lastSessionId', sessionId);
    }
    const start = performance.now();
    // Fire all eight calls in the same parallel batch the chat-room
    // loader uses now (post fb850d2/eaeabaf). The diagnostics page
    // mirrors the production fetch shape so timing reflects what
    // the user actually feels.
    const probes: Array<Promise<EndpointResult>> = [
      timeFetch('GET /api/sessions/<id>', `/api/sessions/${encodeURIComponent(sessionId)}`),
      timeFetch('GET /api/sessions (list)', '/api/sessions'),
      timeFetch('GET /api/sessions/<id>/messages?limit=10', `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=10`),
      timeFetch('GET /api/sessions/<id>/tasks', `/api/sessions/${encodeURIComponent(sessionId)}/tasks`),
      timeFetch('GET /api/sessions/<id>/file-refs', `/api/sessions/${encodeURIComponent(sessionId)}/file-refs`),
      timeFetch('GET /api/sessions/<id>/attachments', `/api/sessions/${encodeURIComponent(sessionId)}/attachments`),
      timeFetch('GET /api/sessions/<id>/participants', `/api/sessions/${encodeURIComponent(sessionId)}/participants`),
      timeFetch('GET /api/plans?session_id=<id>&limit=1', `/api/plans?session_id=${encodeURIComponent(sessionId)}&limit=1`),
    ];
    results = await Promise.all(probes);
    totalMs = performance.now() - start;
    running = false;
  }

  async function copyResults() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const dump = formatDump();
    await navigator.clipboard.writeText(dump).catch(() => {});
  }

  function formatDump(): string {
    const lines: string[] = [];
    lines.push(`ANT speed diagnostics — ${new Date().toISOString()}`);
    lines.push(`Origin: ${location.origin}`);
    lines.push(`User agent: ${userAgent}`);
    if (viewport) lines.push(`Viewport: ${viewport.w}x${viewport.h} (DPR ${viewport.dpr})`);
    if (serviceWorker) lines.push(`Service worker: controlled=${serviceWorker.controlled}${serviceWorker.scope ? ` scope=${serviceWorker.scope}` : ''}`);
    if (networkInfo) lines.push(`Network: ${JSON.stringify(networkInfo)}`);
    lines.push('');
    lines.push(`Session ID: ${sessionInput.trim()}`);
    lines.push(`Total wall-clock (parallel batch): ${totalMs?.toFixed(0)}ms`);
    lines.push('');
    lines.push('Endpoint                                                 status   TTFB     Total    Bytes');
    for (const r of results) {
      const ttfb = r.ttfbMs !== null ? `${r.ttfbMs.toFixed(0)}ms` : '—';
      lines.push(`${r.label.padEnd(56)} ${String(r.status).padStart(3)}      ${ttfb.padStart(8)} ${r.totalMs.toFixed(0).padStart(6)}ms ${r.bytes.toString().padStart(8)}B${r.error ? ` ERROR: ${r.error}` : ''}`);
    }
    return lines.join('\n');
  }
</script>

<svelte:head>
  <title>Speed diagnostics · ANT</title>
</svelte:head>

<main class="page">
  <header>
    <h1>Speed diagnostics</h1>
    <p class="lede">
      Time the chat-room load endpoints from this device. Open this on
      Safari mobile to capture the real mobile-network path; numbers are
      what the user actually feels, not localhost-only measurement.
    </p>
  </header>

  <section class="panel">
    <h2>Environment</h2>
    <dl>
      <dt>Origin</dt><dd><code>{typeof location !== 'undefined' ? location.origin : ''}</code></dd>
      <dt>User agent</dt><dd><code class="wrap">{userAgent || '—'}</code></dd>
      {#if viewport}
        <dt>Viewport</dt><dd>{viewport.w} × {viewport.h} (DPR {viewport.dpr})</dd>
      {/if}
      {#if serviceWorker}
        <dt>Service worker</dt>
        <dd>
          controlled={serviceWorker.controlled ? 'yes' : 'no'}
          {#if serviceWorker.scope}· scope <code>{serviceWorker.scope}</code>{/if}
        </dd>
      {/if}
      {#if networkInfo}
        <dt>Network</dt>
        <dd>
          {#if networkInfo.effectiveType}{networkInfo.effectiveType}{/if}
          {#if networkInfo.downlink !== undefined}· {networkInfo.downlink} Mbps{/if}
          {#if networkInfo.rtt !== undefined}· RTT {networkInfo.rtt}ms{/if}
          {#if networkInfo.saveData}· save-data on{/if}
        </dd>
      {/if}
    </dl>
  </section>

  <section class="panel">
    <h2>Run a chat-room probe</h2>
    <p class="hint">
      Paste a session ID (the room URL ends in <code>/session/&lt;id&gt;</code>).
      The diagnostics fire all eight critical-path endpoints in one
      Promise.all and report status, TTFB, total time, and payload size.
    </p>
    <form onsubmit={(e) => { e.preventDefault(); void run(); }}>
      <input
        type="text"
        placeholder="O393IH1zFgd_nujpQgnof"
        bind:value={sessionInput}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        class="session-input"
        aria-label="Session ID"
      />
      <button type="submit" disabled={running || !sessionInput.trim()}>
        {running ? 'Running…' : 'Run probe'}
      </button>
    </form>
  </section>

  {#if results.length > 0}
    <section class="panel">
      <div class="result-head">
        <h2>Results</h2>
        <div class="result-meta">
          <span>Total: <strong>{totalMs?.toFixed(0)}ms</strong></span>
          <button type="button" class="copy" onclick={copyResults}>Copy as text</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Status</th>
            <th>TTFB</th>
            <th>Total</th>
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r}
            <tr class:fail={!r.ok}>
              <td><code>{r.label}</code></td>
              <td>{r.status}</td>
              <td>{r.ttfbMs !== null ? `${r.ttfbMs.toFixed(0)}ms` : '—'}</td>
              <td>{r.totalMs.toFixed(0)}ms</td>
              <td>{r.bytes.toLocaleString()}B</td>
            </tr>
            {#if r.error}
              <tr class="fail-detail"><td colspan="5"><code>{r.error}</code></td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</main>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
    color: var(--text);
    font-family: var(--font-sans);
  }
  header {
    margin-bottom: 1.5rem;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 700;
  }
  .lede {
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }
  .panel {
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
    background: var(--bg-card);
  }
  .panel h2 {
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0 0 0.75rem;
    line-height: 1.45;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(120px, auto) 1fr;
    column-gap: 0.75rem;
    row-gap: 0.4rem;
    font-size: 0.85rem;
  }
  dt {
    color: var(--text-muted);
    font-weight: 600;
  }
  dd {
    margin: 0;
    color: var(--text);
    word-break: break-word;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.82em;
  }
  .wrap {
    word-break: break-all;
  }
  form {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .session-input {
    flex: 1 1 220px;
    min-width: 0;
    padding: 0.5rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-input, var(--bg-card));
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
  button[type="submit"] {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 0;
    background: #6366F1;
    color: #fff;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  button[type="submit"]:disabled { opacity: 0.55; cursor: not-allowed; }
  .copy {
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .copy:hover { color: var(--text); }
  .result-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .result-meta {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  th, td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  th {
    color: var(--text-muted);
    font-weight: 600;
  }
  td:nth-child(2), td:nth-child(3), td:nth-child(4), td:nth-child(5) {
    font-family: var(--font-mono);
    text-align: right;
  }
  tr.fail td { color: #EF4444; }
  tr.fail-detail td { padding-top: 0; padding-bottom: 0.5rem; color: #EF4444; word-break: break-word; }
</style>
