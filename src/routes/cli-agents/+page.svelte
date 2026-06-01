<!--
  /cli-agents — minimal dashboard for ANT-spawned CLI bridges
  (CLI-HOOK-BRIDGE Phase 5 UI, 2026-05-15, JWPK).

  Lists running codex / pi bridges, lets you start new ones with a cwd,
  send a small set of common RPC commands, jump to the hook timeline
  for any session, and stop bridges cleanly.

  Polls /api/cli-agents every 4s for fresh state. Auto-refreshes the
  list after start/stop/command actions.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  type Agent = {
    handleId: string;
    cli: 'codex' | 'pi';
    cwd: string | null;
    spawnedAtMs: number;
    sessionId: string | null;
  };

  let agents = $state<Agent[]>([]);
  let loading = $state(true);
  let actionError = $state('');
  let pendingCli = $state<'codex' | 'pi' | null>(null);
  let pendingCwd = $state('');
  // Per-agent prompt text + send-in-flight state (dogfood finding #6, 2026-05-24).
  // Keyed by handleId so each running agent has its own textarea.
  let promptText = $state<Record<string, string>>({});
  let promptSending = $state<Record<string, boolean>>({});
  let promptStatus = $state<Record<string, string>>({});

  async function refresh(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch('/api/cli-agents');
      if (!res.ok) return;
      const body = (await res.json()) as { agents?: Agent[] };
      agents = body.agents ?? [];
      actionError = '';
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function startAgent(): Promise<void> {
    if (!pendingCli) return;
    actionError = '';
    try {
      const res = await fetch('/api/cli-agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cli: pendingCli,
          ...(pendingCwd.trim().length > 0 ? { cwd: pendingCwd.trim() } : {})
        })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`start failed (${res.status}): ${text.slice(0, 200)}`);
      }
      pendingCli = null;
      pendingCwd = '';
      await refresh();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function stopAgent(handleId: string): Promise<void> {
    actionError = '';
    try {
      const res = await fetch(`/api/cli-agents/${encodeURIComponent(handleId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`stop failed (${res.status})`);
      await refresh();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function sendPrompt(agent: Agent): Promise<void> {
    const text = (promptText[agent.handleId] ?? '').trim();
    if (text.length === 0) return;
    promptSending[agent.handleId] = true;
    promptStatus[agent.handleId] = 'sending…';
    actionError = '';
    try {
      const res = await fetch(`/api/cli-agents/${encodeURIComponent(agent.handleId)}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`prompt failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const result = (await res.json()) as { threadId?: string };
      promptText[agent.handleId] = '';
      promptStatus[agent.handleId] = result.threadId
        ? `sent → thread ${result.threadId.slice(0, 8)}`
        : 'sent';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      promptStatus[agent.handleId] = `error: ${message}`;
      actionError = message;
    } finally {
      promptSending[agent.handleId] = false;
    }
  }

  async function sendQuickCommand(agent: Agent, command: Record<string, unknown>): Promise<void> {
    actionError = '';
    try {
      const res = await fetch(`/api/cli-agents/${encodeURIComponent(agent.handleId)}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`command failed (${res.status}): ${text.slice(0, 200)}`);
      }
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function formatAge(ms: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  onMount(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(poll);
  });
</script>

<svelte:head><title>CLI agents — ANT</title></svelte:head>

<main class="cli-agents-page">
  <header>
    <a class="back-link" href="/">← back</a>
    <div>
      <h1>CLI agents</h1>
      <p class="sub">ANT-spawned codex / pi bridges. Events flow into the same cli_hook_events table that powers the per-terminal activity badge.</p>
    </div>
  </header>

  <section class="start-bar">
    <h2>Start a new agent</h2>
    <div class="start-controls">
      <label>
        Working directory (optional)
        <input
          type="text"
          placeholder="/Users/you/project"
          bind:value={pendingCwd}
        />
      </label>
      <div class="start-buttons">
        <button
          type="button"
          class="primary codex"
          onclick={() => { pendingCli = 'codex'; void startAgent(); }}
        >
          Start codex
        </button>
        <button
          type="button"
          class="primary pi"
          onclick={() => { pendingCli = 'pi'; void startAgent(); }}
        >
          Start pi
        </button>
      </div>
    </div>
    {#if actionError}
      <p class="error" role="alert">{actionError}</p>
    {/if}
  </section>

  {#if loading}
    <p class="status-block">Loading agents…</p>
  {:else if agents.length === 0}
    <p class="status-block empty">No agents running. Click Start codex or Start pi above. (Bin must be on PATH.)</p>
  {:else}
    <ul class="agent-list">
      {#each agents as agent (agent.handleId)}
        <li class="agent-card cli-{agent.cli}">
          <div class="agent-head">
            <span class="agent-badge">{agent.cli}</span>
            <span class="agent-id">{agent.handleId}</span>
            <span class="agent-age">{formatAge(agent.spawnedAtMs)} old</span>
          </div>
          <div class="agent-meta">
            {#if agent.cwd}<span>cwd: <code>{agent.cwd}</code></span>{/if}
            <span>
              session:
              {#if agent.sessionId}{agent.sessionId.slice(0, 12)}{:else}<em>resolving…</em>{/if}
            </span>
          </div>
          <div class="agent-actions">
            {#if agent.sessionId}
              <a class="action-link" href="/cli-hooks/{agent.sessionId}">timeline →</a>
            {/if}
            {#if agent.cli === 'pi'}
              <button type="button" class="action-btn" onclick={() => void sendQuickCommand(agent, { type: 'compact' })}>/compact</button>
              <button type="button" class="action-btn" onclick={() => void sendQuickCommand(agent, { type: 'abort' })}>abort</button>
            {/if}
            <button type="button" class="action-btn danger" onclick={() => void stopAgent(agent.handleId)}>stop</button>
          </div>
          {#if agent.cli === 'codex' || agent.cli === 'pi'}
            <!-- Pi parity added 2026-05-25 (PR follow-up to #52): pi's
                 `{type:'prompt', message}` PiRpcCommand wires through the
                 same handle.sendPrompt() facade, no UI branching needed. -->
            <div class="agent-prompt">
              <label for="prompt-{agent.handleId}" class="prompt-label">Send a prompt</label>
              <textarea
                id="prompt-{agent.handleId}"
                rows="3"
                placeholder="Type your brief here (Cmd/Ctrl+Enter to send)…"
                bind:value={promptText[agent.handleId]}
                disabled={promptSending[agent.handleId]}
                onkeydown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void sendPrompt(agent);
                  }
                }}
              ></textarea>
              <div class="prompt-row">
                <button
                  type="button"
                  class="action-btn prompt-send"
                  disabled={promptSending[agent.handleId] || !(promptText[agent.handleId] ?? '').trim()}
                  onclick={() => void sendPrompt(agent)}
                >
                  {promptSending[agent.handleId] ? 'Sending…' : 'Send'}
                </button>
                {#if promptStatus[agent.handleId]}
                  <span class="prompt-status">{promptStatus[agent.handleId]}</span>
                {/if}
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .cli-agents-page { padding: 1rem 1.5rem; max-width: 1100px; margin: 0 auto; }
  header { display: flex; gap: 1rem; margin-bottom: 1.2rem; align-items: flex-start; }
  .back-link { color: var(--ink-soft, #777); text-decoration: none; font-size: 0.9rem; margin-top: 0.4rem; }
  .back-link:hover { text-decoration: underline; }
  h1 { margin: 0 0 0.25rem 0; font-size: 1.6rem; }
  .sub { margin: 0; color: var(--ink-soft, #777); font-size: 0.85rem; }
  .start-bar {
    background: var(--surface-card, #f8f8f8); padding: 1rem 1.2rem;
    border-radius: 0.6rem; border: 1px solid var(--line-soft, #e0e0e0);
    margin-bottom: 1.2rem;
  }
  .start-bar h2 { margin: 0 0 0.6rem 0; font-size: 1rem; }
  .start-controls { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
  .start-controls label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; flex: 1; min-width: 240px; }
  .start-controls input { padding: 0.45rem 0.6rem; border: 1px solid var(--line-soft, #ccc); border-radius: 0.35rem; font-size: 0.9rem; }
  .start-buttons { display: flex; gap: 0.4rem; }
  .primary { padding: 0.55rem 1rem; font-weight: 700; font-size: 0.9rem; color: white; border: none; border-radius: 999px; cursor: pointer; }
  .primary.codex { background: #4a6cf7; }
  .primary.pi { background: #c44a9b; }
  .error { color: var(--accent, #c63b3b); margin: 0.6rem 0 0 0; font-size: 0.85rem; }
  .status-block { padding: 1.5rem; color: var(--ink-soft, #777); background: var(--surface-card, #f4f4f4); border-radius: 0.5rem; }
  .agent-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .agent-card {
    background: var(--surface-card, #fff); border: 1px solid var(--line-soft, #e0e0e0);
    border-left-width: 4px; border-radius: 0.5rem; padding: 0.7rem 0.9rem;
  }
  .agent-card.cli-codex { border-left-color: #4a6cf7; }
  .agent-card.cli-pi { border-left-color: #c44a9b; }
  .agent-head { display: flex; gap: 0.6rem; align-items: baseline; }
  .agent-badge { font-size: 0.72rem; font-weight: 800; padding: 0.1rem 0.45rem; border-radius: 0.3rem; background: var(--bg, #f0f0f0); text-transform: uppercase; }
  .agent-id { font-family: ui-monospace, monospace; font-size: 0.8rem; color: var(--ink-soft, #555); }
  .agent-age { margin-left: auto; font-size: 0.78rem; color: var(--ink-soft, #777); }
  .agent-meta { display: flex; gap: 0.8rem; font-size: 0.8rem; color: var(--ink-soft, #666); margin-top: 0.35rem; flex-wrap: wrap; }
  .agent-meta code { font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .agent-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; flex-wrap: wrap; }
  .action-link { font-size: 0.8rem; color: var(--accent, #4a6cf7); text-decoration: none; align-self: center; }
  .action-link:hover { text-decoration: underline; }
  .action-btn { padding: 0.3rem 0.7rem; font-size: 0.8rem; border: 1px solid var(--line-soft, #ccc); background: var(--bg, white); border-radius: 0.35rem; cursor: pointer; }
  .action-btn:hover:not(:disabled) { border-color: var(--accent, #4a6cf7); }
  .action-btn.danger { color: var(--accent, #c63b3b); border-color: var(--accent, #c63b3b); }
  /* Prompt channel — codex-only, per-agent (dogfood finding #6, 2026-05-24). */
  .agent-prompt { margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed var(--line-soft, #e0e0e0); display: flex; flex-direction: column; gap: 0.35rem; }
  .prompt-label { font-size: 0.72rem; color: var(--ink-soft, #777); text-transform: uppercase; letter-spacing: 0.04em; }
  .agent-prompt textarea {
    width: 100%; resize: vertical; min-height: 3.6rem;
    padding: 0.45rem 0.6rem; font-family: ui-monospace, monospace; font-size: 0.85rem;
    border: 1px solid var(--line-soft, #ccc); border-radius: 0.35rem;
    background: var(--bg, white); color: inherit;
  }
  .agent-prompt textarea:focus { outline: 2px solid var(--accent, #4a6cf7); outline-offset: 1px; }
  .prompt-row { display: flex; gap: 0.6rem; align-items: center; }
  .prompt-send { font-weight: 700; }
  .prompt-status { font-size: 0.78rem; color: var(--ink-soft, #777); }
</style>
