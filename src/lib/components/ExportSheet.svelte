<script lang="ts">
  // Export evidence sheet — UI affordance over POST /api/sessions/:id/export.
  // Per locked contract (deliverANT 2026-05-04): consume the existing endpoint
  // as-is, target picker + per-target status + copy paths/commands, no new
  // server contract. The CLI equivalent of the current selection is shown in
  // the footer for users who prefer terminal workflows.

  interface Target {
    id: string;
    label: string;
    kind: string;
    description: string;
    configured: boolean;
    vault_path?: string;
    output_dir?: string;
  }

  interface TargetResult {
    ok: boolean;
    skipped?: boolean;
    path?: string | null;
    deck_dir?: string;
    note?: string;
    vault_path?: string;
    [key: string]: unknown;
  }

  let {
    open,
    sessionId,
    onClose,
  }: {
    open: boolean;
    sessionId: string;
    onClose: () => void;
  } = $props();

  let targets = $state<Target[]>([]);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let results = $state<Record<string, TargetResult> | null>(null);
  let copyHint = $state<string | null>(null);

  $effect(() => {
    if (open && targets.length === 0) {
      void loadTargets();
    }
  });

  async function loadTargets() {
    error = null;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      targets = Array.isArray(data?.targets) ? data.targets : [];
      // Default selection: all configured targets.
      selected = new Set(targets.filter((t) => t.configured).map((t) => t.id));
    } catch (e) {
      error = (e as Error)?.message || 'Failed to load export targets';
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll() {
    selected = new Set(targets.map((t) => t.id));
  }

  function selectNone() {
    selected = new Set();
  }

  async function runExport() {
    if (selected.size === 0 || loading) return;
    loading = true;
    error = null;
    results = null;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        error = data?.error || 'Export failed';
      } else {
        results = (data?.targets ?? {}) as Record<string, TargetResult>;
      }
    } catch (e) {
      error = (e as Error)?.message || 'Export request failed';
    } finally {
      loading = false;
    }
  }

  function copyToClipboard(text: string, hint = 'Copied') {
    if (!text) return;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
    copyHint = hint;
    setTimeout(() => { copyHint = null; }, 1200);
  }

  const cliCommand = $derived.by(() => {
    if (selected.size === 0) return `ant sessions export ${sessionId}`;
    const list = Array.from(selected).join(',');
    return `ant sessions export ${sessionId} --target ${list}`;
  });

  function backdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function resultPath(r: TargetResult): string | null {
    if (typeof r.path === 'string' && r.path) return r.path;
    if (typeof r.deck_dir === 'string' && r.deck_dir) return r.deck_dir;
    return null;
  }

  function statusGlyph(r: TargetResult): string {
    if (r.ok) return '✓';
    if (r.skipped) return '—';
    return '✗';
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="export-backdrop"
    onclick={backdropClick}
    onkeydown={handleKey}
    role="dialog"
    aria-modal="true"
    aria-label="Export evidence"
    tabindex="-1"
  >
    <div class="export-sheet">
      <header class="export-head">
        <h2>Export evidence</h2>
        <button
          type="button"
          class="touch-target export-close"
          onclick={onClose}
          aria-label="Close export sheet"
        >✕</button>
      </header>

      {#if error}
        <div class="export-error" role="alert">{error}</div>
      {/if}

      <div class="export-body">
        {#if targets.length === 0 && !error}
          <div class="export-empty">Loading targets…</div>
        {:else}
          <ul class="export-targets" role="group" aria-label="Export targets">
            {#each targets as t (t.id)}
              <li class="export-target">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onchange={() => toggleSelect(t.id)}
                    aria-label="Select {t.label}"
                  />
                  <div class="export-target-text">
                    <div class="export-target-label">{t.label}</div>
                    <div class="export-target-desc">{t.description}</div>
                    {#if t.vault_path}
                      <div class="export-target-path">{t.vault_path}</div>
                    {/if}
                    {#if t.output_dir}
                      <div class="export-target-path">{t.output_dir}</div>
                    {/if}
                  </div>
                </label>
              </li>
            {/each}
          </ul>
          {#if targets.length > 1}
            <div class="export-bulk">
              <button type="button" onclick={selectAll}>Select all</button>
              <span class="export-bulk-sep">·</span>
              <button type="button" onclick={selectNone}>Select none</button>
            </div>
          {/if}
        {/if}
      </div>

      {#if results}
        <div class="export-results" role="status" aria-live="polite">
          <h3>Results</h3>
          {#each Object.entries(results) as [tid, r] (tid)}
            <div
              class="export-result"
              class:ok={r.ok}
              class:fail={!r.ok && !r.skipped}
              class:skipped={r.skipped}
            >
              <span class="export-result-icon" aria-hidden="true">{statusGlyph(r)}</span>
              <div class="export-result-body">
                <div class="export-result-target">{tid.replace('_', '-')}</div>
                {#if resultPath(r)}
                  <div class="export-result-path">
                    <span>{resultPath(r)}</span>
                    <button
                      type="button"
                      class="export-copy"
                      onclick={() => copyToClipboard(resultPath(r) || '', 'Path copied')}
                      aria-label="Copy {tid} path"
                    >⧉</button>
                  </div>
                {/if}
                {#if r.note}
                  <div class="export-result-note">{r.note}</div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <footer class="export-foot">
        <code class="export-cli" title={cliCommand}>{cliCommand}</code>
        <button
          type="button"
          class="export-cli-copy"
          onclick={() => copyToClipboard(cliCommand, 'CLI copied')}
          aria-label="Copy CLI command"
        >Copy</button>
        <button
          type="button"
          class="touch-target export-run"
          disabled={loading || selected.size === 0}
          onclick={runExport}
        >
          {#if loading}Exporting…{:else}Export{#if selected.size > 0} ({selected.size}){/if}{/if}
        </button>
      </footer>

      {#if copyHint}
        <div class="export-toast" role="status" aria-live="polite">{copyHint}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .export-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: max(8vh, var(--ant-safe-top, 0px));
    padding-bottom: max(8vh, var(--ant-safe-bottom, 0px));
    padding-left: var(--ant-safe-left, 0px);
    padding-right: var(--ant-safe-right, 0px);
    z-index: 80;
  }

  .export-sheet {
    width: min(560px, 92vw);
    max-height: min(720px, 84vh);
    background: var(--bg-card, #FFFFFF);
    border: 1px solid #E5E7EB;
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .export-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #E5E7EB;
    flex-shrink: 0;
  }

  .export-head h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .export-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 6px;
  }

  .export-close:hover {
    background: #F3F4F6;
    color: var(--text);
  }

  .export-error {
    margin: 8px 16px 0;
    padding: 8px 12px;
    background: #FEE2E2;
    color: #B91C1C;
    border-radius: 6px;
    font-size: 12px;
  }

  .export-empty {
    padding: 16px;
    font-size: 12px;
    color: var(--text-faint);
    font-style: italic;
    text-align: center;
  }

  .export-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px 16px;
  }

  .export-targets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .export-target {
    margin: 0;
  }

  .export-target label {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    cursor: pointer;
    align-items: flex-start;
  }

  .export-target label:hover {
    background: #F9FAFB;
  }

  .export-target input {
    margin-top: 3px;
    cursor: pointer;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .export-target-text {
    flex: 1;
    min-width: 0;
  }

  .export-target-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .export-target-desc {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
    line-height: 1.4;
  }

  .export-target-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    margin-top: 4px;
    word-break: break-all;
  }

  .export-bulk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .export-bulk button {
    padding: 2px 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    border-radius: 4px;
  }

  .export-bulk button:hover {
    background: #F3F4F6;
    color: var(--text);
  }

  .export-bulk-sep {
    opacity: 0.4;
  }

  .export-results {
    border-top: 1px solid #E5E7EB;
    padding: 12px 16px;
    max-height: 36vh;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .export-results h3 {
    font-size: 10px;
    margin: 0 0 8px 0;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .export-result {
    display: flex;
    gap: 10px;
    padding: 6px 0;
    align-items: flex-start;
  }

  .export-result + .export-result {
    border-top: 1px solid #F3F4F6;
  }

  .export-result-icon {
    font-weight: 700;
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    color: var(--text-faint);
    margin-top: 2px;
  }

  .export-result.ok .export-result-icon { color: #22C55E; }
  .export-result.fail .export-result-icon { color: #EF4444; }
  .export-result.skipped .export-result-icon { color: var(--text-faint); }

  .export-result-body {
    flex: 1;
    min-width: 0;
  }

  .export-result-target {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    text-transform: capitalize;
  }

  .export-result-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    word-break: break-all;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }

  .export-copy {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 12px;
    border-radius: 4px;
  }

  .export-copy:hover {
    background: #F3F4F6;
    color: var(--text);
  }

  .export-result-note {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
    line-height: 1.4;
  }

  .export-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #E5E7EB;
    background: #F9FAFB;
    flex-shrink: 0;
  }

  .export-cli {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 4px;
    padding: 5px 8px;
    white-space: nowrap;
    overflow-x: auto;
    min-width: 0;
  }

  .export-cli-copy {
    padding: 5px 10px;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .export-cli-copy:hover {
    background: #FFFFFF;
    color: var(--text);
  }

  .export-run {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    background: #6366F1;
    color: #FFFFFF;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .export-run:hover:not(:disabled) {
    background: #4F46E5;
  }

  .export-run:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .export-toast {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    background: rgba(17, 24, 39, 0.92);
    color: #FFFFFF;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    pointer-events: none;
  }
</style>
