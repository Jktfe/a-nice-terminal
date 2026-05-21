<!--
  TerminalHookActivity — CLI-HOOK-BRIDGE Phase 1C (2026-05-15).

  Shows the latest cli_hook_events row for a terminal's session, mapping
  the most recent hook event onto a human-readable activity badge:
    PreToolUse(Bash)    → "Running: Bash"
    PreToolUse(Edit)    → "Editing: <path>"
    PostToolUse         → "<tool> finished"
    UserPromptSubmit    → "Thinking..."
    Stop                → "Idle"
    SessionStart/End    → boundary chip
    Pre/PostCompact     → "Compacting..."

  Polls every 3s for fresh state. Bound by sessionId (the CLI's session
  identifier, NOT ANT's terminalId). If sessionId is empty (terminal
  hasn't reported one yet), the component renders nothing.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  type Props = {
    sessionId: string | null | undefined;
  };

  let { sessionId }: Props = $props();

  type CliHookEvent = {
    id: number;
    source_cli: string;
    session_id: string;
    hook_event_name: string;
    received_at_ms: number;
    tool_name: string | null;
    payload: string; // JSON string
  };

  let latestEvent = $state<CliHookEvent | null>(null);
  let lastFetchAtMs = $state<number | null>(null);

  async function fetchLatest(): Promise<void> {
    if (!browser || !sessionId || sessionId.trim().length === 0) {
      latestEvent = null;
      return;
    }
    try {
      const res = await fetch(`/api/cli-hook?session=${encodeURIComponent(sessionId)}&limit=1`);
      if (!res.ok) return;
      const body = (await res.json()) as { events?: CliHookEvent[] };
      latestEvent = body.events && body.events.length > 0 ? body.events[0] : null;
      lastFetchAtMs = Date.now();
    } catch {
      // Non-blocking — if the receiver is down, the rest of the terminal card still works.
    }
  }

  onMount(() => {
    void fetchLatest();
    const poll = setInterval(() => { void fetchLatest(); }, 3000);
    return () => clearInterval(poll);
  });

  $effect(() => {
    // Re-fetch when sessionId changes (terminal swaps to a new agent).
    if (sessionId) void fetchLatest();
  });

  function describeEvent(event: CliHookEvent): { label: string; tone: 'active' | 'idle' | 'boundary' | 'tool' | 'compact' } {
    const name = event.hook_event_name;
    const tool = event.tool_name;
    if (name === 'PreToolUse' && tool) {
      if (tool === 'Bash') return { label: `Running: Bash`, tone: 'tool' };
      if (tool === 'Edit' || tool === 'Write') return { label: `${tool === 'Edit' ? 'Editing' : 'Writing'} a file`, tone: 'tool' };
      if (tool === 'Read') return { label: `Reading a file`, tone: 'tool' };
      return { label: `Running: ${tool}`, tone: 'tool' };
    }
    if (name === 'PostToolUse' && tool) return { label: `${tool} finished`, tone: 'idle' };
    if (name === 'UserPromptSubmit') return { label: 'Thinking...', tone: 'active' };
    if (name === 'Stop') return { label: 'Idle', tone: 'idle' };
    if (name === 'SessionStart') return { label: 'Session started', tone: 'boundary' };
    if (name === 'SessionEnd') return { label: 'Session ended', tone: 'boundary' };
    if (name === 'PreCompact') return { label: 'Compacting...', tone: 'compact' };
    if (name === 'PostCompact') return { label: 'Compaction done', tone: 'compact' };
    return { label: name, tone: 'idle' };
  }

  function ago(ms: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  const view = $derived.by(() => {
    if (!latestEvent) return null;
    const description = describeEvent(latestEvent);
    return {
      ...description,
      timestamp: ago(latestEvent.received_at_ms),
      sourceCli: latestEvent.source_cli,
      sessionShort: latestEvent.session_id.slice(0, 8)
    };
  });
</script>

{#if view}
  <div class="hook-activity tone-{view.tone}" role="status" aria-live="polite">
    <span class="activity-label">{view.label}</span>
    <span class="activity-meta">
      <span class="meta-time">{view.timestamp}</span>
      <a class="meta-link" href="/cli-hooks/{latestEvent!.session_id}" title="Open hook event timeline">
        timeline ↗
      </a>
    </span>
  </div>
{/if}

<style>
  .hook-activity {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.35rem 0.7rem;
    background: var(--bg, #fafafa);
    border-top: 1px solid var(--line-soft, #e0e0e0);
    border-bottom: 1px solid var(--line-soft, #e0e0e0);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink, #333);
  }
  .tone-active { background: rgba(255, 200, 0, 0.12); }
  .tone-tool { background: rgba(60, 120, 220, 0.12); }
  .tone-idle { background: rgba(120, 120, 120, 0.08); }
  .tone-boundary { background: rgba(60, 180, 100, 0.12); }
  .tone-compact { background: rgba(180, 80, 200, 0.12); }
  .activity-label { font-weight: 700; }
  .activity-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--ink-soft, #777);
    font-weight: 500;
  }
  .meta-link {
    color: var(--accent, #4a6cf7);
    text-decoration: none;
  }
  .meta-link:hover { text-decoration: underline; }
</style>
