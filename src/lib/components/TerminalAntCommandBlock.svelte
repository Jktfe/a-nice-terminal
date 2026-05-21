<!--
  TerminalAntCommandBlock.svelte — FRONT-3v2-2 per design 2026-05-14.
  Encapsulates items 4-9 from the lift list for command + tool_call kinds:
    - Sticky head (position:sticky top:0 z-index:1)
    - Status dot (green / red / faint on command kind exit_code)
    - Copy-command + copy-output buttons with 1.2s "Copied" fade
    - Collapsible output body (chevron + first-line preview + "+N more")
    - Metadata compacting (cwd-last-2 + fmtDuration)
    - onRerun callback — fires ONLY for trust='high' command kind
  Renders both command and tool_call kinds (shared shape).
-->
<script lang="ts">
  type AntEvent = {
    id?: number;
    ts_ms: number;
    kind: string;
    source?: string;
    trust?: 'high' | 'medium' | 'raw' | string;
    text: string;
    payload?: string;
    raw_ref?: string | null;
  };

  type Props = {
    event: AntEvent;
    onRerun?: (cmd: string) => void;
  };
  let { event, onRerun }: Props = $props();

  let expanded = $state(false);
  let copied = $state<'cmd' | 'out' | null>(null);

  const trust = $derived(event.trust ?? 'raw');
  const isHighTrust = $derived(trust === 'high');
  const isCommand = $derived(event.kind === 'command');

  const payload = $derived.by(() => {
    if (!event.payload) return null;
    try { return JSON.parse(event.payload) as Record<string, unknown>; }
    catch { return null; }
  });

  const exitCode = $derived.by(() => {
    const p = payload;
    if (!p) return null;
    const ec = p['exit_code'];
    return typeof ec === 'number' ? ec : null;
  });

  const cwd = $derived.by(() => {
    const p = payload;
    return p && typeof p['cwd'] === 'string' ? (p['cwd'] as string) : null;
  });

  const durationMs = $derived.by(() => {
    const p = payload;
    return p && typeof p['duration_ms'] === 'number' ? (p['duration_ms'] as number) : null;
  });

  const output = $derived.by(() => {
    const p = payload;
    if (p && typeof p['output'] === 'string') return p['output'] as string;
    if (p && typeof p['result'] === 'string') return p['result'] as string;
    return '';
  });

  const lineCount = $derived.by(() => {
    if (!output) return 0;
    let n = 1;
    for (let i = 0; i < output.length; i++) if (output.charCodeAt(i) === 10) n++;
    return output.endsWith('\n') ? n - 1 : n;
  });

  const firstLine = $derived.by(() => {
    if (!output) return '';
    const idx = output.indexOf('\n');
    return idx === -1 ? output : output.slice(0, idx);
  });

  const statusDotColor = $derived.by(() => {
    if (!isCommand || exitCode === null) return 'var(--ink-soft)';
    return exitCode === 0 ? 'var(--ok, #4caf50)' : 'var(--accent, #c63b3b)';
  });

  function fmtCwd(path: string | null): string {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return '…/' + parts.slice(-2).join('/');
  }

  function fmtDuration(ms: number | null): string {
    if (ms === null) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${sec}s`;
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function copy(text: string, which: 'cmd' | 'out'): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = which;
      setTimeout(() => { if (copied === which) copied = null; }, 1200);
    } catch {
      /* silent — clipboard unavailable */
    }
  }

  function handleRerun(): void {
    if (!isHighTrust || !isCommand) return;
    onRerun?.(event.text);
  }
</script>

<article class="ant-cmd-block" data-kind={event.kind} data-trust={trust} style="--cb-status: {statusDotColor};">
  <header class="cb-head">
    <span class="status-dot" aria-hidden="true"></span>
    <code class="cb-cmd" title={event.text}>{event.text}</code>
    <div class="cb-meta">
      {#if cwd}<span class="meta-item cwd" title={cwd}>{fmtCwd(cwd)}</span>{/if}
      {#if durationMs !== null}<span class="meta-item">{fmtDuration(durationMs)}</span>{/if}
      <time class="meta-item">{fmtTime(event.ts_ms)}</time>
      {#if exitCode !== null && isCommand}
        <span class="meta-item exit" data-ok={exitCode === 0}>{exitCode === 0 ? '✓' : '✗'} {exitCode}</span>
      {/if}
    </div>
    <div class="cb-actions">
      <button type="button" class="action" onclick={() => void copy(event.text, 'cmd')} title="Copy command">
        {copied === 'cmd' ? 'Copied' : 'Copy cmd'}
      </button>
      {#if output}
        <button type="button" class="action" onclick={() => void copy(output, 'out')} title="Copy output">
          {copied === 'out' ? 'Copied' : 'Copy out'}
        </button>
      {/if}
      {#if isHighTrust && isCommand && onRerun}
        <button type="button" class="action rerun" onclick={handleRerun} title="Re-run command">↻ Re-run</button>
      {/if}
    </div>
  </header>

  {#if output}
    <div class="cb-body">
      {#if lineCount <= 3 || expanded}
        <pre>{output}</pre>
      {:else}
        <button type="button" class="expand-toggle" onclick={() => { expanded = true; }}>
          <span class="chev">▸</span>
          <code class="preview">{firstLine}</code>
          <span class="more">+{lineCount - 1} more line{lineCount - 1 === 1 ? '' : 's'}</span>
        </button>
      {/if}
      {#if expanded && lineCount > 3}
        <button type="button" class="collapse-toggle" onclick={() => { expanded = false; }}>▾ Collapse</button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .ant-cmd-block {
    border: 1px solid var(--line-soft); border-radius: 0.5rem;
    background: var(--surface-card);
    overflow: hidden;
  }
  .ant-cmd-block[data-trust="high"] { border-color: var(--accent); border-width: 1.5px; }
  .ant-cmd-block[data-trust="medium"] { border-style: dashed; }

  .cb-head {
    position: sticky; top: 0; z-index: 1;
    display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.5rem;
    align-items: center; padding: 0.45rem 0.65rem;
    background: var(--surface-card);
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.78rem;
  }
  .status-dot {
    width: 0.55rem; height: 0.55rem; border-radius: 50%;
    background: var(--cb-status);
  }
  .cb-cmd {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem; color: var(--ink-strong); font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cb-meta { display: flex; gap: 0.45rem; align-items: center; color: var(--ink-soft); }
  .meta-item { font-family: ui-monospace, monospace; }
  .meta-item.cwd { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; }
  .meta-item.exit[data-ok="true"] { color: var(--ok, #4caf50); }
  .meta-item.exit[data-ok="false"] { color: var(--accent, #c63b3b); }
  .cb-actions { display: flex; gap: 0.3rem; }
  .action {
    padding: 0.2rem 0.45rem; border-radius: 0.35rem;
    border: 1px solid var(--line-soft); background: var(--bg);
    color: var(--ink-strong); font-size: 0.72rem; cursor: pointer;
    font-family: ui-monospace, monospace;
  }
  .action:hover { border-color: var(--ink-soft); }
  .action.rerun { color: var(--accent); border-color: var(--accent); }

  .cb-body { padding: 0.45rem 0.65rem; }
  .cb-body pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, monospace; font-size: 0.82rem; color: var(--ink-strong);
  }
  .expand-toggle, .collapse-toggle {
    display: flex; align-items: center; gap: 0.4rem;
    width: 100%; padding: 0.25rem 0; border: none; background: transparent;
    color: var(--ink-soft); font-size: 0.8rem; cursor: pointer; text-align: left;
  }
  .expand-toggle:hover, .collapse-toggle:hover { color: var(--ink-strong); }
  .expand-toggle .chev { color: var(--accent); font-weight: 800; }
  .expand-toggle .preview {
    font-family: ui-monospace, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink-strong); flex: 1 1 auto;
  }
  .expand-toggle .more { font-size: 0.72rem; }
</style>
