<script lang="ts">
  import { NOCTURNE, surfaceTokens } from '$lib/nocturne';
  import NocturneIcon from './NocturneIcon.svelte';
  import type {
    RunEvent,
    CommandBlockPayload,
    AgentPromptPayload,
    ArtifactPayload,
  } from './CommandBlock/types';

  let {
    event,
    themeMode = 'dark',
    defaultExpanded = false,
    onRerun,
    onBookmark,
    onRespond,
  }: {
    event: RunEvent;
    themeMode?: 'dark' | 'light';
    defaultExpanded?: boolean;
    onRerun?: (command: string, eventId: string) => void;
    onBookmark?: (eventId: string) => void;
    onRespond?: (promptId: string, choice: string) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  // Init-from-prop is intentional: defaultExpanded seeds the local state
  // (controlled-uncontrolled pattern). Subsequent toggles are owned here.
  let expanded = $state(defaultExpanded);
  let copied = $state<'cmd' | 'out' | null>(null);

  const s = $derived(surfaceTokens(themeMode));
  const isDark = $derived(themeMode === 'dark');

  // R4 §1: trust:'raw' bytes never render as rich content. Hard rule.
  // R4 §3e: trust tiers gate the render path uniformly across kinds.
  const trustTier = $derived(event.trust);

  // Status dot — intent + outcome only, not session chrome.
  const statusColor = $derived.by(() => {
    if (event.kind !== 'command_block') return s.textFaint;
    const exit = (event.payload as CommandBlockPayload | undefined)?.exit_code;
    if (exit === null || exit === undefined) return s.textFaint;
    if (exit === 0) return isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600];
    return NOCTURNE.semantic.danger;
  });

  function fmtDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${sec}s`;
  }

  function fmtTime(iso: string | null | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  }

  function fmtCwd(path: string | null | undefined): string {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return '…/' + parts.slice(-2).join('/');
  }

  function firstLine(text: string | null | undefined): string {
    if (!text) return '';
    const idx = text.indexOf('\n');
    return idx === -1 ? text : text.slice(0, idx);
  }

  function lineCount(text: string | null | undefined): number {
    if (!text) return 0;
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return text.endsWith('\n') ? n - 1 : n;
  }

  async function copyText(text: string, which: 'cmd' | 'out') {
    try {
      await navigator.clipboard.writeText(text);
      copied = which;
      setTimeout(() => { if (copied === which) copied = null; }, 1200);
    } catch {
      // Clipboard unavailable (sandboxed iframe, http context). Silent — no toast in M3.
    }
  }
</script>

<article
  class="cb"
  class:cb--raw={trustTier === 'raw'}
  data-kind={event.kind}
  data-trust={trustTier}
  style="
    --cb-bg: {isDark ? NOCTURNE.ink[800] : '#FFFFFF'};
    --cb-bg-hover: {isDark ? NOCTURNE.ink[700] : NOCTURNE.neutral[50]};
    --cb-border: {s.hairline};
    --cb-border-strong: {s.hairlineStrong};
    --cb-text: {s.text};
    --cb-text-muted: {s.textMuted};
    --cb-text-faint: {s.textFaint};
    --cb-accent: {statusColor};
  "
>
  <header class="cb-head">
    <span class="cb-dot" aria-hidden="true"></span>

    {#if event.kind === 'command_block'}
      {@const p = event.payload as CommandBlockPayload | undefined}
      <code class="cb-cmd" title={p?.command ?? ''}>{p?.command ?? '(no command)'}</code>
      <div class="cb-meta">
        {#if p?.cwd}<span class="cb-meta-item cb-cwd" title={p.cwd}>{fmtCwd(p.cwd)}</span>{/if}
        {#if p?.duration_ms !== null && p?.duration_ms !== undefined}
          <span class="cb-meta-item">{fmtDuration(p.duration_ms)}</span>
        {/if}
        {#if p?.started_at}
          <time class="cb-meta-item" datetime={p.started_at} title={p.started_at}>{fmtTime(p.started_at)}</time>
        {/if}
      </div>
    {:else if event.kind === 'agent_prompt'}
      {@const p = event.payload as AgentPromptPayload | undefined}
      <span class="cb-cmd cb-cmd--prompt">
        <span class="cb-agent">{p?.agent ?? '@agent'}</span>
        <span class="cb-prompt-text">{p?.prompt ?? ''}</span>
      </span>
      <div class="cb-meta">
        <time class="cb-meta-item" datetime={new Date(event.ts).toISOString()}>{fmtTime(new Date(event.ts).toISOString())}</time>
      </div>
    {:else if event.kind === 'artifact'}
      {@const p = event.payload as ArtifactPayload | undefined}
      <code class="cb-cmd cb-cmd--artifact">{p?.label ?? p?.hash?.slice(0, 16) ?? 'artifact'}</code>
      <div class="cb-meta">
        {#if p?.mime}<span class="cb-meta-item">{p.mime}</span>{/if}
        {#if p?.bytes}<span class="cb-meta-item">{(p.bytes / 1024).toFixed(1)}KB</span>{/if}
      </div>
    {:else}
      <span class="cb-cmd cb-cmd--unknown">{event.kind}</span>
      <div class="cb-meta"></div>
    {/if}

    <div class="cb-tools" role="toolbar" aria-label="Block actions">
      {#if event.kind === 'command_block'}
        {@const p = event.payload as CommandBlockPayload | undefined}
        <button
          class="cb-tool"
          type="button"
          aria-label="Copy command"
          title={copied === 'cmd' ? 'Copied' : 'Copy command'}
          onclick={(e) => { e.stopPropagation(); if (p?.command) copyText(p.command, 'cmd'); }}
        >
          {#if copied === 'cmd'}
            <NocturneIcon name="check" size={11} color={NOCTURNE.emerald[400]} />
          {:else}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={s.textFaint} stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          {/if}
        </button>
        {#if p?.output}
          <button
            class="cb-tool"
            type="button"
            aria-label="Copy output"
            title={copied === 'out' ? 'Copied' : 'Copy output'}
            onclick={(e) => { e.stopPropagation(); copyText(p.output ?? '', 'out'); }}
          >
            <NocturneIcon name={copied === 'out' ? 'check' : 'terminal'} size={11} color={copied === 'out' ? NOCTURNE.emerald[400] : s.textFaint} />
          </button>
        {/if}
        {#if onRerun && p?.command}
          <button
            class="cb-tool"
            type="button"
            aria-label="Re-run"
            title="Re-run command"
            onclick={(e) => { e.stopPropagation(); onRerun(p.command, event.id); }}
          >
            <NocturneIcon name="play" size={11} color={s.textFaint} />
          </button>
        {/if}
      {/if}
      {#if onBookmark}
        <button
          class="cb-tool"
          type="button"
          aria-label="Bookmark"
          title="Bookmark"
          onclick={(e) => { e.stopPropagation(); onBookmark(event.id); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={s.textFaint} stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      {/if}
    </div>

    {#if (event.kind === 'command_block' && (event.payload as CommandBlockPayload | undefined)?.output) || event.kind === 'artifact' || event.kind === 'agent_prompt'}
      <button
        class="cb-toggle"
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse block' : 'Expand block'}
        onclick={() => (expanded = !expanded)}
      >
        <svg class="cb-chevron" class:cb-chevron--open={expanded} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    {/if}
  </header>

  {#if event.kind === 'command_block'}
    {@const p = event.payload as CommandBlockPayload | undefined}
    {#if !expanded && p?.output}
      <div class="cb-preview">
        <span class="cb-preview-line">{firstLine(p.output)}</span>
        {#if lineCount(p.output) > 1}
          <span class="cb-preview-more">+{lineCount(p.output) - 1} {lineCount(p.output) === 2 ? 'line' : 'lines'}</span>
        {/if}
      </div>
    {/if}
    {#if expanded && p?.output}
      <pre class="cb-output">{p.output}</pre>
      {#if p.output_truncated}
        <div class="cb-trunc">…output truncated. Open Raw Terminal for full bytes.</div>
      {/if}
    {/if}
  {:else if event.kind === 'agent_prompt' && expanded}
    {@const p = event.payload as AgentPromptPayload | undefined}
    {#if p?.options && p.options.length}
      <div class="cb-prompt-options">
        {#each p.options as opt}
          <button
            class="cb-prompt-opt"
            type="button"
            onclick={(e) => { e.stopPropagation(); if (p.prompt_id && onRespond) onRespond(p.prompt_id, opt); }}
          >{opt}</button>
        {/each}
      </div>
    {/if}
  {:else if event.kind === 'artifact' && expanded}
    {@const p = event.payload as ArtifactPayload | undefined}
    {#if p?.hash}
      {#if p.mime?.startsWith('image/')}
        <figure class="cb-artifact">
          <img src="/api/artifacts/{p.hash}" alt={p.caption ?? p.label ?? 'artifact'} loading="lazy" />
          {#if p.caption}<figcaption>{p.caption}</figcaption>{/if}
        </figure>
      {:else}
        <a class="cb-artifact-link" href="/api/artifacts/{p.hash}" target="_blank" rel="noopener">
          {p.label ?? p.hash}
        </a>
      {/if}
    {/if}
  {/if}
</article>

<style>
  .cb {
    display: grid;
    grid-template-rows: auto auto;
    background: var(--cb-bg);
    border-left: 2px solid var(--cb-accent);
    border-top: 0.5px solid var(--cb-border);
    border-right: 0.5px solid var(--cb-border);
    border-bottom: 0.5px solid var(--cb-border);
    border-radius: 0 4px 4px 0;
    margin-bottom: 6px;
    transition: background 120ms ease;
    container-type: inline-size;
  }
  .cb:hover { background: var(--cb-bg-hover); }
  .cb:hover .cb-tools { opacity: 1; }
  .cb:focus-within .cb-tools { opacity: 1; }

  .cb-head {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    align-items: baseline;
    gap: 10px;
    padding: 7px 10px 7px 9px;
    position: sticky;
    top: 0;
    background: inherit;
    z-index: 1;
  }

  .cb-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--cb-accent);
    align-self: center;
    flex-shrink: 0;
  }

  .cb-cmd {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--cb-text);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .cb-cmd--prompt {
    display: flex;
    gap: 8px;
    font-family: var(--font-sans);
    font-weight: 400;
  }
  .cb-cmd--artifact {
    color: var(--cb-text-muted);
    font-size: 12px;
  }
  .cb-cmd--unknown {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--cb-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .cb-agent {
    color: var(--cb-accent);
    font-weight: 600;
    flex-shrink: 0;
  }

  .cb-prompt-text {
    color: var(--cb-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cb-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--cb-text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .cb-cwd {
    color: var(--cb-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 22ch;
  }
  @container (max-width: 480px) {
    .cb-cwd { display: none; }
  }

  .cb-tools {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .cb-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: transparent;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
  }
  .cb-tool:hover { background: var(--cb-border-strong); }
  .cb-tool:focus-visible {
    outline: 1px solid var(--cb-accent);
    outline-offset: 1px;
  }

  .cb-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--cb-text-faint);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .cb-chevron {
    transition: transform 160ms ease;
  }
  .cb-chevron--open {
    transform: rotate(180deg);
  }

  .cb-preview {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 10px 7px 26px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--cb-text-faint);
    overflow: hidden;
  }
  .cb-preview-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .cb-preview-more {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 3px;
    background: var(--cb-border);
    font-size: 10px;
  }

  .cb-output {
    margin: 0;
    padding: 8px 12px 10px 26px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--cb-text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 0.5px solid var(--cb-border);
    background: rgba(0, 0, 0, 0.04);
    max-height: 360px;
    overflow-y: auto;
  }

  /* trust:raw — never rich. Tighter mono, dimmer, no soft-wrap on ANSI. */
  .cb--raw .cb-output {
    color: var(--cb-text-faint);
    white-space: pre;
    overflow-x: auto;
  }

  .cb-trunc {
    padding: 6px 12px 8px 26px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--cb-text-faint);
    border-top: 0.5px dashed var(--cb-border);
    font-style: italic;
  }

  .cb-prompt-options {
    display: flex;
    gap: 6px;
    padding: 8px 10px 10px 26px;
    border-top: 0.5px solid var(--cb-border);
  }
  .cb-prompt-opt {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 11px;
    border-radius: 5px;
    background: transparent;
    color: var(--cb-text);
    border: 0.5px solid var(--cb-border-strong);
    cursor: pointer;
  }
  .cb-prompt-opt:hover { background: var(--cb-border); }
  .cb-prompt-opt:first-child {
    background: var(--cb-accent);
    color: #fff;
    border-color: var(--cb-accent);
  }

  .cb-artifact {
    margin: 0;
    padding: 10px 12px 12px 26px;
    border-top: 0.5px solid var(--cb-border);
  }
  .cb-artifact img {
    max-width: 100%;
    height: auto;
    display: block;
    border-radius: 3px;
    border: 0.5px solid var(--cb-border);
  }
  .cb-artifact figcaption {
    margin-top: 6px;
    font-size: 11px;
    color: var(--cb-text-faint);
  }
  .cb-artifact-link {
    display: inline-block;
    margin: 0;
    padding: 8px 12px 10px 26px;
    border-top: 0.5px solid var(--cb-border);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--cb-accent);
    text-decoration: none;
  }
  .cb-artifact-link:hover { text-decoration: underline; }
</style>
