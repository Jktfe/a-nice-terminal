<script lang="ts">
  import { NOCTURNE, agentColor } from '$lib/nocturne';
  import NocturneIcon from './NocturneIcon.svelte';

  interface RunEvent {
    id: string;
    session_id: string;
    ts: number;
    source: 'hook' | 'json' | 'terminal' | 'status' | 'tmux';
    trust: 'high' | 'medium' | 'raw';
    kind: string;
    text: string;
    payload?: Record<string, unknown>;
    raw_ref?: string;
  }

  let {
    events = [],
    sessionId,
    searchQuery = '',
  }: {
    events: RunEvent[];
    sessionId: string;
    searchQuery?: string;
  } = $props();

  let scrollEl = $state<HTMLElement | null>(null);
  let atBottom = $state(true);
  let expandedIds = $state(new Set<string>());

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function onScroll() {
    if (!scrollEl) return;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  }

  $effect(() => {
    events;
    if (atBottom) setTimeout(scrollToBottom, 30);
  });

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedIds = next;
  }

  // Filter by search
  const filtered = $derived(
    searchQuery
      ? events.filter(e => e.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.kind.toLowerCase().includes(searchQuery.toLowerCase()))
      : events
  );

  // Group consecutive same-kind events (e.g. multiple progress lines)
  const grouped = $derived.by(() => {
    const groups: { kind: string; events: RunEvent[]; collapsed: boolean }[] = [];
    for (const e of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.kind === 'progress' && e.kind === 'progress' && last.events.length < 20) {
        last.events.push(e);
      } else {
        groups.push({ kind: e.kind, events: [e], collapsed: e.kind === 'progress' });
      }
    }
    return groups;
  });

  // Trust badge colour
  function trustColor(trust: string): string {
    if (trust === 'high') return NOCTURNE.emerald[400];
    if (trust === 'medium') return NOCTURNE.amber[400];
    return NOCTURNE.ink[300];
  }

  // Kind icon
  function kindIcon(kind: string): string {
    switch (kind) {
      case 'tool_call': case 'tool_result': return 'terminal';
      case 'permission': return 'cpu';
      case 'message': case 'assistant': return 'send';
      case 'status': return 'sparkle';
      case 'progress': return 'play';
      case 'error': return 'x';
      default: return 'sparkle';
    }
  }

  // Kind accent colour
  function kindAccent(kind: string): string {
    switch (kind) {
      case 'tool_call': case 'tool_result': return NOCTURNE.blue[400];
      case 'permission': return NOCTURNE.amber[400];
      case 'message': case 'assistant': return NOCTURNE.ink[100];
      case 'status': return NOCTURNE.emerald[400];
      case 'progress': return NOCTURNE.ink[200];
      case 'error': return NOCTURNE.semantic.danger;
      default: return NOCTURNE.ink[200];
    }
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function isCodeBlock(text: string): boolean {
    return text.includes('```') || text.startsWith('  ') || text.includes('\n  ');
  }
</script>

<div class="run-view" bind:this={scrollEl} onscroll={onScroll}>
  {#if filtered.length === 0}
    <div class="run-empty">
      <NocturneIcon name="sparkle" size={24} color="var(--text-faint)" />
      <p>No events yet</p>
    </div>
  {:else}
    {#each grouped as group}
      {#if group.kind === 'progress' && group.events.length > 1}
        <!-- Collapsed progress group -->
        <button
          class="run-group-toggle"
          onclick={() => toggleExpand(group.events[0].id)}
        >
          <div class="run-dot" style="background: {NOCTURNE.ink[300]};"></div>
          <span class="run-kind" style="color: {NOCTURNE.ink[200]};">progress</span>
          <span class="run-group-count">{group.events.length} steps</span>
          <span class="run-time">{formatTime(group.events[0].ts)} — {formatTime(group.events[group.events.length - 1].ts)}</span>
          <svg class="run-chevron" class:expanded={expandedIds.has(group.events[0].id)} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {#if expandedIds.has(group.events[0].id)}
          {#each group.events as event (event.id)}
            {@render eventRow(event)}
          {/each}
        {/if}
      {:else}
        {#each group.events as event (event.id)}
          {@render eventRow(event)}
        {/each}
      {/if}
    {/each}
  {/if}

  <!-- Scroll to bottom button -->
  {#if !atBottom}
    <button class="run-scroll-btn" onclick={scrollToBottom} aria-label="Scroll ANT Terminal to bottom">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  {/if}
</div>

{#snippet eventRow(event: RunEvent)}
  <div
    class="run-event"
    class:run-event--high={event.trust === 'high'}
    class:run-event--error={event.kind === 'error'}
  >
    <!-- Left: trust dot + kind -->
    <div class="run-event-left">
      <div class="run-dot" style="background: {trustColor(event.trust)};"></div>
      <NocturneIcon name={kindIcon(event.kind)} size={12} color={kindAccent(event.kind)} />
    </div>

    <!-- Center: content -->
    <div class="run-event-body">
      <div class="run-event-header">
        <span class="run-kind" style="color: {kindAccent(event.kind)};">{event.kind}</span>
        <span class="run-source">{event.source}</span>
        <span class="run-time">{formatTime(event.ts)}</span>
      </div>

      {#if event.kind === 'tool_call' && event.payload?.command}
        <code class="run-code">{event.payload.command}</code>
      {:else if event.kind === 'tool_result' && event.payload?.output}
        <button class="run-expand-btn" onclick={() => toggleExpand(event.id)}>
          {expandedIds.has(event.id) ? 'Collapse' : 'Expand'} output
        </button>
        {#if expandedIds.has(event.id)}
          <pre class="run-output">{event.payload.output}</pre>
        {/if}
      {:else if isCodeBlock(event.text)}
        <pre class="run-output">{event.text}</pre>
      {:else}
        <p class="run-text">{event.text}</p>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  .run-view {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px 16px;
    background: var(--bg);
    position: relative;
  }

  .run-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--text-faint);
    font-size: 13px;
  }

  .run-event {
    display: flex;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 0.5px solid var(--hairline);
    animation: slide-in 0.2s ease-out;
  }

  .run-event--high {
    background: rgba(34, 197, 94, 0.03);
    margin: 0 -16px;
    padding: 8px 16px;
  }

  .run-event--error {
    background: rgba(240, 68, 56, 0.05);
    margin: 0 -16px;
    padding: 8px 16px;
  }

  .run-event-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 2px;
    flex-shrink: 0;
    width: 20px;
  }

  .run-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .run-event-body {
    flex: 1;
    min-width: 0;
  }

  .run-event-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }

  .run-kind {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }

  .run-source {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    padding: 1px 5px;
    background: var(--hairline);
    border-radius: 3px;
  }

  .run-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .run-text {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
    margin: 0;
    word-break: break-word;
  }

  .run-code {
    display: block;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg-input);
    padding: 8px 10px;
    border-radius: var(--radius-input);
    border: 0.5px solid var(--hairline-strong);
    word-break: break-all;
    white-space: pre-wrap;
  }

  .run-output {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
    background: var(--bg-input);
    padding: 8px 10px;
    border-radius: var(--radius-input);
    border: 0.5px solid var(--hairline);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    margin-top: 4px;
  }

  .run-expand-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    background: var(--hairline);
    border: 0.5px solid var(--hairline-strong);
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .run-expand-btn:hover {
    background: var(--hairline-strong);
  }

  .run-group-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 0;
    background: none;
    border: none;
    border-bottom: 0.5px solid var(--hairline);
    cursor: pointer;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .run-group-toggle:hover {
    color: var(--text-muted);
  }

  .run-group-count {
    font-size: 10px;
    padding: 1px 6px;
    background: var(--hairline);
    border-radius: 4px;
  }

  .run-chevron {
    margin-left: auto;
    transition: transform var(--duration-fast) var(--spring-default);
    color: var(--text-faint);
  }

  .run-chevron.expanded {
    transform: rotate(180deg);
  }

  .run-scroll-btn {
    position: sticky;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    color: var(--text-muted);
    z-index: 10;
  }

  .run-scroll-btn:hover {
    background: var(--bg-elevated);
  }

  @keyframes slide-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
