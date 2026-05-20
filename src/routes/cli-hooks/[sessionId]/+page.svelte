<!--
  /cli-hooks/<sessionId> — CLI-HOOK-BRIDGE Phase 1C timeline view.

  Renders every cli_hook_events row for one CLI session as a scrollable
  timeline newest-first. Auto-refreshes every 5s.

  Linked from TerminalHookActivity badge. Direct URL works too.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';

  type CliHookEvent = {
    id: number;
    source_cli: string;
    session_id: string;
    hook_event_name: string;
    received_at_ms: number;
    transcript_path: string | null;
    cwd: string | null;
    permission_mode: string | null;
    effort_level: string | null;
    tool_name: string | null;
    tool_use_id: string | null;
    payload: string;
  };

  const sessionId = $derived(page.params.sessionId ?? '');

  let events = $state<CliHookEvent[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');

  async function fetchEvents(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/cli-hook?session=${encodeURIComponent(sessionId)}&limit=200`);
      if (!res.ok) {
        errorMessage = `Could not load events (HTTP ${res.status})`;
        return;
      }
      const body = (await res.json()) as { events?: CliHookEvent[] };
      events = body.events ?? [];
      errorMessage = '';
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void fetchEvents();
    const poll = setInterval(() => { void fetchEvents(); }, 5000);
    return () => clearInterval(poll);
  });

  function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString();
  }

  function payloadPreview(payloadJson: string): string {
    try {
      const parsed = JSON.parse(payloadJson);
      const compact = JSON.stringify(parsed, null, 2);
      if (compact.length <= 320) return compact;
      return compact.slice(0, 320) + '\n  …';
    } catch {
      return payloadJson;
    }
  }

  function eventClass(eventName: string): string {
    if (eventName.startsWith('Pre')) return 'event-pre';
    if (eventName.startsWith('Post')) return 'event-post';
    if (eventName === 'UserPromptSubmit') return 'event-prompt';
    if (eventName === 'Stop') return 'event-stop';
    if (eventName.startsWith('Session')) return 'event-session';
    return 'event-other';
  }
</script>

<svelte:head>
  <title>CLI hooks — {sessionId.slice(0, 8)}</title>
</svelte:head>

<main class="cli-hooks-page">
  <header class="page-header">
    <a class="back-link" href="/">← back</a>
    <div class="title-block">
      <h1>CLI hook events</h1>
      <p class="sub">
        session <code>{sessionId}</code>
        {#if events.length > 0}
          · {events.length} event{events.length === 1 ? '' : 's'}
          · most recent {formatTime(events[0].received_at_ms)}
        {/if}
      </p>
    </div>
  </header>

  {#if loading}
    <p class="loading">Loading hook events…</p>
  {:else if errorMessage}
    <p class="error" role="alert">{errorMessage}</p>
  {:else if events.length === 0}
    <p class="empty">No events received for this session yet. If you've just installed hooks, the next Claude Code action will appear here.</p>
  {:else}
    <ol class="event-list">
      {#each events as event (event.id)}
        <li class="event-row {eventClass(event.hook_event_name)}">
          <div class="event-head">
            <span class="event-name">{event.hook_event_name}</span>
            {#if event.tool_name}<span class="event-tool">tool: {event.tool_name}</span>{/if}
            <span class="event-source">{event.source_cli}</span>
            <span class="event-time" title={formatDate(event.received_at_ms)}>{formatTime(event.received_at_ms)}</span>
          </div>
          {#if event.cwd || event.permission_mode || event.effort_level || event.tool_use_id}
            <div class="event-meta">
              {#if event.cwd}<span class="meta-chip">cwd: <code>{event.cwd}</code></span>{/if}
              {#if event.permission_mode}<span class="meta-chip">perm: {event.permission_mode}</span>{/if}
              {#if event.effort_level}<span class="meta-chip">effort: {event.effort_level}</span>{/if}
              {#if event.tool_use_id}<span class="meta-chip">tool-use: <code>{event.tool_use_id}</code></span>{/if}
            </div>
          {/if}
          <details>
            <summary>payload</summary>
            <pre class="payload">{payloadPreview(event.payload)}</pre>
          </details>
        </li>
      {/each}
    </ol>
  {/if}
</main>

<style>
  .cli-hooks-page {
    padding: 1rem 1.5rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  .page-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  .back-link {
    color: var(--ink-soft, #777);
    text-decoration: none;
    font-size: 0.9rem;
    margin-top: 0.4rem;
  }
  .back-link:hover { text-decoration: underline; }
  .title-block h1 {
    margin: 0 0 0.25rem 0;
    font-size: 1.6rem;
  }
  .sub {
    margin: 0;
    color: var(--ink-soft, #777);
    font-size: 0.85rem;
  }
  .sub code { font-family: ui-monospace, monospace; }
  .loading, .empty {
    padding: 1.5rem;
    color: var(--ink-soft, #777);
    background: var(--surface-card, #f4f4f4);
    border-radius: 0.5rem;
  }
  .error {
    padding: 1rem;
    background: rgba(220, 60, 60, 0.1);
    color: var(--accent, #c63b3b);
    border-radius: 0.5rem;
  }
  .event-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .event-row {
    padding: 0.7rem 0.9rem;
    background: var(--surface-card, #fff);
    border: 1px solid var(--line-soft, #e0e0e0);
    border-left-width: 4px;
    border-radius: 0.4rem;
  }
  .event-pre { border-left-color: #4a6cf7; }
  .event-post { border-left-color: #888; }
  .event-prompt { border-left-color: #f7c84a; }
  .event-stop { border-left-color: #6b6b6b; }
  .event-session { border-left-color: #4ab17a; }
  .event-other { border-left-color: #bbb; }
  .event-head {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  .event-name { font-weight: 700; font-size: 1rem; }
  .event-tool {
    background: var(--bg, #f0f0f0);
    padding: 0.15rem 0.45rem;
    border-radius: 0.3rem;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .event-source {
    font-size: 0.75rem;
    color: var(--ink-soft, #777);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .event-time {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--ink-soft, #777);
    font-family: ui-monospace, monospace;
  }
  .event-meta {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
    flex-wrap: wrap;
  }
  .meta-chip {
    font-size: 0.75rem; color: var(--ink-soft, #555);
    background: var(--bg, #f5f5f5);
    padding: 0.15rem 0.45rem; border-radius: 0.3rem;
  }
  details { margin-top: 0.4rem; }
  details summary {
    cursor: pointer; font-size: 0.78rem;
    color: var(--ink-soft, #777);
  }
  .payload {
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
    background: var(--bg, #f7f7f7);
    padding: 0.6rem;
    border-radius: 0.3rem;
    overflow-x: auto;
    margin: 0.4rem 0 0 0;
    white-space: pre-wrap;
  }
</style>
