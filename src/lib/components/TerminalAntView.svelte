<!--
  TerminalAntView.svelte — v4 ANT view.
  Renders transcript-derived + interactive run-events only. RAW/PTY bytes stay
  in the Raw tab; linked chat stays in chat_messages.

  Subscribes:
    - GET /api/terminals/[id]/run-events?...sources=transcript,interactive
    - EventSource /api/terminals/[id]/run-events/stream?...sources=...

  Kind enum (locked with T2c-impl-1): raw / message / thinking / tool_call /
  command / agent_prompt — unknown kinds fall through to generic block.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import CommandBlock from './CommandBlock.svelte';
  import AgentEventCard from './AgentEventCard.svelte';
  import TerminalSpecialKeys from './TerminalSpecialKeys.svelte';
  import type { RunEvent, RunEventTrust, RunEventSource, CommandBlockPayload, AgentPromptPayload } from './CommandBlock/types';
  import { theme } from '$lib/stores/theme.svelte';
  import {
    postInput as ptyPostInput,
    sendText as ptySendText,
    handleSpecialKey as ptyHandleSpecialKey
  } from '$lib/terminal/ptyInput';

  // Adapter: build v3 AgentEventCard "message" shape from fresh-ANT
  // agent_prompt run event. v3 expects { content: JSON string, meta: JSON string }
  // where content = { class, payload, text? }. Status pending by default.
  function toAgentMessage(ev: AntEvent): { id: string; content: string; meta: string } {
    const payload = (() => {
      if (!ev.payload) return {};
      try { return JSON.parse(ev.payload) as Record<string, unknown>; }
      catch { return {}; }
    })();
    const eventClass = typeof payload['eventClass'] === 'string'
      ? (payload['eventClass'] as string)
      : 'free_text';
    return {
      id: String(ev.id ?? ev._localId),
      content: JSON.stringify({ class: eventClass, payload, text: ev.text }),
      meta: '{}'
    };
  }

  function parseToolCallText(text: string): { name: string; input?: unknown } | null {
    const splitAt = text.indexOf(' ');
    if (splitAt <= 0) return text.length > 0 ? { name: text } : null;
    const name = text.slice(0, splitAt).trim();
    const rest = text.slice(splitAt + 1).trim();
    if (name.length === 0) return null;
    if (!rest.startsWith('{')) return { name, input: rest };
    try {
      return { name, input: JSON.parse(rest) as unknown };
    } catch {
      return { name, input: rest };
    }
  }

  function toolCallPayloadFromEvent(ev: AntEvent, rawPayload: Record<string, unknown> | null): CommandBlockPayload {
    const p = rawPayload as { name?: string; input?: unknown } | null;
    const parsed = parseToolCallText(ev.text);
    const name = p?.name ?? parsed?.name ?? 'tool';
    const input = p?.input ?? parsed?.input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const inputObj = input as Record<string, unknown>;
      if (typeof inputObj.command === 'string') {
        const { command, ...rest } = inputObj;
        const output = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '';
        return { command: `${name}: ${command}`, output };
      }
    }
    return {
      command: name,
      output: input !== undefined && input !== null
        ? (typeof input === 'string' ? input : JSON.stringify(input, null, 2))
        : ''
    };
  }

  // v3 AgentEventCard fires onRespond({ type, event_id, event_content, choice }).
  // Map the response type → PTY keystroke per JWPK agent-prompt protocol:
  //   approve/retry      → 'y\r'    (yes + Enter)
  //   deny               → 'n\r'    (no + Enter)
  //   abort              → '\x03'   (Ctrl+C)
  //   select index=i     → '${i+1}\r' (number choice — 1-indexed Enter)
  //   text value=v       → 'v\r'
  type V3Respond = {
    type: string;
    event_id?: string;
    event_content?: string;
    choice?: { action?: string; selected?: string; index?: number; value?: string; yes?: boolean };
  };
  async function handleAgentRespond(payload: unknown): Promise<void> {
    const r = payload as V3Respond | null;
    if (!r || typeof r.type !== 'string') return;
    let keystroke = '';
    switch (r.type) {
      case 'approve':
      case 'yes':
        keystroke = 'y\r';
        break;
      case 'deny':
      case 'no':
        keystroke = 'n\r';
        break;
      case 'retry':
        keystroke = '\r'; // re-press Enter — let shell/agent retry the prior prompt
        break;
      case 'abort':
        keystroke = '\x03';
        break;
      case 'confirm':
        keystroke = r.choice?.yes === true ? 'y\r' : 'n\r';
        break;
      case 'select':
        if (typeof r.choice?.index === 'number') keystroke = String(r.choice.index + 1) + '\r';
        break;
      case 'text':
        if (typeof r.choice?.value === 'string') keystroke = r.choice.value + '\r';
        break;
    }
    if (keystroke.length === 0) return;
    // A5: single shared PTY-input path (was an inline fetch — behaviour
    // identical, one path now).
    await ptyPostInput(terminalId, keystroke);
  }

  // Adapter: map fresh-ANT terminal_run_events shape → v3 RunEvent shape
  // (V3-LIFT-2 + delta-2 per canonical fix). Coordinator recommended fix:
  // tool_call also maps to v3 command_block at adapter layer so v3
  // CommandBlock's rich affordances (copy/sticky/status) apply — name → command,
  // input → output JSON. Preserves verbatim v3 CommandBlock lift (no edits).
  function toV3Event(ev: AntEvent): RunEvent {
    const rawPayload: Record<string, unknown> | null = (() => {
      if (!ev.payload) return null;
      try { return JSON.parse(ev.payload) as Record<string, unknown>; }
      catch { return null; }
    })();

    if (ev.kind === 'tool_call') {
      const mapped = toolCallPayloadFromEvent(ev, rawPayload);
      return {
        id: String(ev.id ?? ev._localId),
        session_id: '',
        ts: ev.ts_ms,
        source: (ev.source ?? 'terminal') as RunEventSource,
        trust: (ev.trust ?? 'raw') as RunEventTrust,
        kind: 'command_block',
        payload: mapped as unknown as Record<string, unknown>
      };
    }

    const kind = ev.kind === 'command' ? 'command_block' : ev.kind;
    const payload: Record<string, unknown> | undefined = (() => {
      if (rawPayload) return rawPayload;
      if (kind === 'command_block') {
        const cmd: CommandBlockPayload = { command: ev.text };
        return cmd as unknown as Record<string, unknown>;
      }
      if (kind === 'agent_prompt') {
        const p: AgentPromptPayload = { agent: ev.source ?? '@agent', prompt: ev.text };
        return p as unknown as Record<string, unknown>;
      }
      return undefined;
    })();
    return {
      id: String(ev.id ?? ev._localId),
      session_id: '',
      ts: ev.ts_ms,
      source: (ev.source ?? 'terminal') as RunEventSource,
      trust: (ev.trust ?? 'raw') as RunEventTrust,
      kind,
      payload
    };
  }

  type Props = {
    terminalId: string;
    onRerun?: (cmd: string) => void;
  };
  let { terminalId, onRerun }: Props = $props();

  // FINDING-1 ANT-input-parity: the ANT view is no longer read-only — a
  // composer + special-keys row push operator input through the SAME
  // shared PTY path the Raw view uses. Transcript above stays read-only;
  // this is additive at the bottom, mirroring Raw's layout.
  let composer = $state('');
  async function submitComposer(): Promise<void> {
    const text = composer;
    if (text.trim().length === 0) return;
    composer = '';
    await ptySendText(terminalId, text);
  }
  function onComposerKeydown(e: KeyboardEvent): void {
    // Enter submits; Shift+Enter inserts a newline (Raw/Chat ergonomics).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitComposer();
    }
  }

  type WireEvent = {
    id?: number;
    ts_ms: number;
    kind: string;
    source?: string;
    trust?: 'high' | 'medium' | 'raw' | string;
    text: string;
    payload?: string;
    raw_ref?: string | null;
  };
  type AntEvent = WireEvent & { _localId: number };

  let nextLocalId = 1;
  function tagLocalId(e: WireEvent): AntEvent {
    return { ...e, _localId: nextLocalId++ };
  }

  const MAX_ROWS = 2000;

  let events = $state<AntEvent[]>([]);
  let scrollEl: HTMLDivElement | undefined = $state();
  let eventSource: EventSource | null = null;
  let lastSeenTsMs = 0;
  let followBottom = $state(true);
  const ANT_EVENT_SOURCES = 'transcript,interactive';
  const ANT_EVENT_KINDS = 'message,thinking,tool_call,command,agent_prompt';

  function antEventsQuery(limit?: number): string {
    const params = new URLSearchParams({
      sources: ANT_EVENT_SOURCES,
      kinds: ANT_EVENT_KINDS
    });
    if (limit !== undefined) params.set('limit', String(limit));
    return params.toString();
  }

  function scrollToBottom(): void {
    if (!scrollEl || !followBottom) return;
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  function handleScroll(): void {
    if (!scrollEl) return;
    const distanceFromBottom = scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
    followBottom = distanceFromBottom < 40;
  }

  function pushEvent(ev: WireEvent): void {
    if (events.length >= MAX_ROWS) events.splice(0, events.length - MAX_ROWS + 1);
    events.push(tagLocalId(ev));
    scrollToBottom();
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function seedHistory(): Promise<void> {
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/run-events?${antEventsQuery(500)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { events?: WireEvent[] };
      const seed = (body.events ?? []).filter((e) => typeof e.text === 'string');
      events = seed.map(tagLocalId);
      lastSeenTsMs = seed.length > 0 ? Math.max(...seed.map((e) => e.ts_ms)) : 0;
      scrollToBottom();
    } catch {
      /* non-blocking */
    }
  }

  onMount(() => {
    if (!browser) return;
    void seedHistory();
    eventSource = new EventSource(
      `/api/terminals/${encodeURIComponent(terminalId)}/run-events/stream?${antEventsQuery()}`
    );
    eventSource.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as WireEvent;
        if (typeof parsed.text !== 'string') return;
        if (parsed.ts_ms <= lastSeenTsMs) return;
        lastSeenTsMs = parsed.ts_ms;
        pushEvent(parsed);
      } catch {
        /* heartbeat / malformed */
      }
    };
    eventSource.onerror = () => { /* EventSource auto-reconnects */ };
  });

  onDestroy(() => {
    // Null the handler before close to silence ERR_INCOMPLETE_CHUNKED_ENCODING
    // browser noise when switching view-modes (FRONT-2 caveat fix).
    if (eventSource) {
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSource.close();
    }
    eventSource = null;
  });
</script>

<section class="ant-view" aria-label="Terminal ANT view">
  <header class="ant-view-toolbar">
    <span class="event-count">{events.length} event{events.length === 1 ? '' : 's'}</span>
    <button type="button" class="follow" class:on={followBottom} onclick={() => { followBottom = true; scrollToBottom(); }}>
      {followBottom ? 'Following ▼' : 'Jump to live ▼'}
    </button>
  </header>

  <div class="ant-stream" bind:this={scrollEl} onscroll={handleScroll}>
    {#if events.length === 0}
      <div class="empty">
        <p><strong>No events yet.</strong></p>
        <p class="muted">
          Transcript and interactive events appear here once the terminal agent
          writes its session log.
        </p>
      </div>
    {:else}
      {#each events as ev (ev._localId)}
        {@const trust = ev.trust ?? 'raw'}
        {#if ev.kind === 'agent_prompt'}
          <AgentEventCard
            message={toAgentMessage(ev)}
            sessionId={terminalId}
            onRespond={(c) => void handleAgentRespond(c)}
          />
        {:else if ev.kind === 'command' || ev.kind === 'tool_call'}
          <CommandBlock
            event={toV3Event(ev)}
            themeMode={theme.isDark ? 'dark' : 'light'}
            onRerun={onRerun ? (cmd) => onRerun?.(cmd) : undefined}
          />
        {:else}
          <article class="event-block" data-kind={ev.kind} data-trust={trust}>
            <header class="event-meta">
              <span class="kind-badge">{ev.kind}</span>
              <span class="trust-badge" data-trust={trust}>{trust}</span>
              {#if ev.source}<span class="source">{ev.source}</span>{/if}
              <time>{formatTime(ev.ts_ms)}</time>
            </header>

            {#if ev.kind === 'message'}
              <div class="body message-body"><pre>{ev.text}</pre></div>
            {:else if ev.kind === 'thinking'}
              <div class="body thinking-body"><em>{ev.text}</em></div>
            {:else if ev.kind === 'agent_prompt'}
              <div class="body prompt-body">
                <strong>Agent asking for input</strong>
                <pre>{ev.text}</pre>
              </div>
            {:else if ev.kind === 'raw'}
              <div class="body raw-body"><pre>{ev.text}</pre></div>
            {:else}
              <div class="body unknown-body">
                <span class="unknown-flag">unknown kind</span>
                <pre>{ev.text}</pre>
              </div>
            {/if}
          </article>
        {/if}
      {/each}
    {/if}
  </div>

  <TerminalSpecialKeys onKey={(seq) => void ptyHandleSpecialKey(terminalId, seq)} />
  <form class="ant-composer" onsubmit={(e) => { e.preventDefault(); void submitComposer(); }}>
    <textarea
      class="ant-composer-input"
      rows="2"
      placeholder="Type input for this terminal — Enter to send, Shift+Enter for newline"
      bind:value={composer}
      onkeydown={onComposerKeydown}
    ></textarea>
    <button type="submit" class="ant-composer-send" disabled={composer.trim().length === 0}>Send</button>
  </form>
</section>

<style>
  .ant-view {
    display: flex; flex-direction: column;
    min-height: 32rem; max-height: 32rem;
    background: var(--bg);
  }
  .ant-view-toolbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.4rem 0.7rem; gap: 0.5rem;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface-card);
    font-size: 0.78rem; color: var(--ink-soft);
  }
  .event-count { font-family: ui-monospace, monospace; }
  .follow {
    padding: 0.2rem 0.55rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--bg);
    color: var(--ink-soft); font-size: 0.75rem; cursor: pointer;
  }
  .follow.on { color: var(--ok, #4caf50); border-color: var(--ok, #4caf50); }

  .ant-composer {
    display: flex; gap: 0.4rem; align-items: stretch;
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--line-soft);
    background: var(--surface-card);
  }
  .ant-composer-input {
    flex: 1 1 auto; resize: none;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line-soft); border-radius: 0.4rem;
    background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .ant-composer-input:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .ant-composer-send {
    flex: 0 0 auto; padding: 0 0.95rem;
    border: 1px solid var(--accent); border-radius: 0.4rem;
    background: var(--accent); color: var(--surface-card);
    font-weight: 700; font-size: 0.82rem; cursor: pointer;
  }
  .ant-composer-send:disabled { opacity: 0.5; cursor: not-allowed; }

  .ant-stream {
    flex: 1 1 auto; overflow-y: auto;
    padding: 0.6rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .empty { margin: auto; max-width: 32rem; text-align: center; color: var(--ink-strong); }
  .empty .muted { color: var(--ink-soft); font-size: 0.88rem; margin-top: 0.4rem; }

  .event-block {
    border: 1px solid var(--line-soft); border-radius: 0.5rem;
    background: var(--surface-card); padding: 0.45rem 0.65rem;
  }
  .event-block[data-trust="high"] { border-color: var(--accent); border-width: 1.5px; }
  .event-block[data-trust="medium"] { border-style: dashed; }
  .event-block[data-kind="thinking"] { background: var(--bg); }
  .event-block[data-kind="agent_prompt"] {
    background: var(--surface-card);
    border-color: var(--warn, #d99518); border-width: 1.5px;
  }

  .event-meta {
    display: flex; align-items: center; gap: 0.45rem;
    font-size: 0.72rem; color: var(--ink-soft); margin-bottom: 0.25rem;
    flex-wrap: wrap;
  }
  .kind-badge {
    text-transform: uppercase; letter-spacing: 0.05em;
    font-weight: 800; color: var(--accent);
  }
  .trust-badge {
    padding: 0 0.4rem; border-radius: 999px;
    border: 1px solid var(--line-soft);
    font-family: ui-monospace, monospace; font-size: 0.7rem;
  }
  .trust-badge[data-trust="high"] { color: var(--ok, #4caf50); border-color: var(--ok, #4caf50); }
  .trust-badge[data-trust="medium"] { color: var(--warn, #d99518); border-color: var(--warn, #d99518); }
  .source { font-family: ui-monospace, monospace; }

  .body {
    margin: 0; color: var(--ink-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.86rem;
  }
  .body pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
  }
  .thinking-body { color: var(--ink-soft); font-style: italic; }
  .prompt-body strong { display: block; color: var(--warn, #d99518); margin-bottom: 0.25rem; }
  .unknown-body .unknown-flag {
    display: inline-block; padding: 0 0.4rem; border-radius: 0.3rem;
    background: var(--bg); color: var(--ink-soft); font-size: 0.72rem;
    margin-bottom: 0.25rem;
  }
</style>
