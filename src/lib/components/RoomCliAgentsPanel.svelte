<!--
  RoomCliAgentsPanel — in-room "Bring in codex" affordance + per-agent
  prompt panel (dogfood findings #4 + #5 follow-up, 2026-05-24).

  Why this is its own component:
    The room page is already 555 lines after the earlier split. Adding the
    bring-in UI inline would inflate it again and risk merge conflicts
    against parallel room-page work. Keeping it isolated also makes the
    component reusable for any other "manage CLI agents in this scope"
    surface (e.g. plans pages) once that pattern emerges.

  Talks to:
    GET  /api/chat-rooms/:roomId/cli-agents   — list room-tagged agents
    POST /api/chat-rooms/:roomId/cli-agents   — spawn + tag
    POST /api/cli-agents/:handleId/prompt     — operator prompt (PR #52)
    DELETE /api/cli-agents/:handleId          — stop

  Polls every 4s, same cadence as /cli-agents dashboard. The codex
  output is NOT auto-posted to the room — operator drives prompts here,
  reads replies via /cli-hooks/:sessionId. Wire-back to chat is the
  follow-up slice once codex MCP/tool config can target ANT endpoints.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  type Props = { roomId: string };
  let { roomId }: Props = $props();

  type Agent = {
    handleId: string;
    cli: 'codex' | 'pi';
    cwd: string | null;
    roomId: string | null;
    spawnedAtMs: number;
    sessionId: string | null;
  };

  let agents = $state<Agent[]>([]);
  let loading = $state(true);
  let actionError = $state('');
  let spawning = $state(false);
  let pendingCwd = $state('');
  let promptText = $state<Record<string, string>>({});
  let promptSending = $state<Record<string, boolean>>({});
  let promptStatus = $state<Record<string, string>>({});
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/cli-agents`);
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

  async function bringInCodex(): Promise<void> {
    spawning = true;
    actionError = '';
    try {
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/cli-agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cli: 'codex',
          ...(pendingCwd.trim().length > 0 ? { cwd: pendingCwd.trim() } : {})
        })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`bring-in failed (${res.status}): ${text.slice(0, 200)}`);
      }
      await refresh();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      spawning = false;
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
      const result = (await res.json()) as { threadId?: string | null };
      promptText[agent.handleId] = '';
      promptStatus[agent.handleId] = result.threadId
        ? `sent → thread ${result.threadId.slice(0, 8)}`
        : 'sent';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      promptStatus[agent.handleId] = `error: ${message}`;
    } finally {
      promptSending[agent.handleId] = false;
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
    pollHandle = setInterval(() => { void refresh(); }, 4000);
  });
  onDestroy(() => {
    if (pollHandle) clearInterval(pollHandle);
  });
</script>

<section class="room-cli-agents" aria-labelledby="bring-in-heading">
  <h3 id="bring-in-heading">Bring in a CLI agent</h3>
  <p class="hint">Spawn a codex into this room context. Output flows to <code>cli_hook_events</code>; reach the timeline via the agent's session link.</p>

  <div class="bring-in-row">
    <label class="cwd-field">
      cwd (optional)
      <input
        type="text"
        placeholder="/Users/you/project"
        bind:value={pendingCwd}
        disabled={spawning}
      />
    </label>
    <button
      type="button"
      class="bring-in-btn"
      disabled={spawning}
      onclick={() => void bringInCodex()}
    >
      {spawning ? 'Spawning…' : 'Bring in codex'}
    </button>
  </div>

  {#if actionError}
    <p class="error" role="alert">{actionError}</p>
  {/if}

  {#if loading}
    <p class="status">Loading agents in this room…</p>
  {:else if agents.length === 0}
    <p class="status empty">No CLI agents in this room yet.</p>
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
              {#if agent.sessionId}<a href="/cli-hooks/{agent.sessionId}">{agent.sessionId.slice(0, 12)} →</a>{:else}<em>resolving…</em>{/if}
            </span>
          </div>
          {#if agent.cli === 'codex'}
            <div class="agent-prompt">
              <label class="prompt-label" for="room-prompt-{agent.handleId}">Send a prompt</label>
              <textarea
                id="room-prompt-{agent.handleId}"
                rows="3"
                placeholder="Type a brief (Cmd/Ctrl+Enter to send)…"
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
          <div class="agent-actions">
            <button type="button" class="action-btn danger" onclick={() => void stopAgent(agent.handleId)}>stop</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .room-cli-agents {
    margin: 1rem 0;
    padding: 0.8rem 1rem;
    background: var(--surface-card, #f8f8f8);
    border: 1px solid var(--line-soft, #e0e0e0);
    border-radius: 0.6rem;
  }
  h3 { margin: 0 0 0.2rem 0; font-size: 0.95rem; }
  .hint { margin: 0 0 0.7rem 0; font-size: 0.78rem; color: var(--ink-soft, #777); }
  .hint code { font-family: ui-monospace, monospace; font-size: 0.74rem; }
  .bring-in-row { display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; }
  .cwd-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; flex: 1; min-width: 220px; color: var(--ink-soft, #666); }
  .cwd-field input {
    padding: 0.4rem 0.55rem; border: 1px solid var(--line-soft, #ccc); border-radius: 0.3rem;
    font-size: 0.85rem; background: var(--bg, white); color: inherit;
  }
  .bring-in-btn {
    padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.85rem; color: white;
    background: #4a6cf7; border: none; border-radius: 999px; cursor: pointer;
  }
  .bring-in-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: var(--accent, #c63b3b); margin: 0.5rem 0 0 0; font-size: 0.82rem; }
  .status { margin: 0.8rem 0 0 0; font-size: 0.82rem; color: var(--ink-soft, #777); }
  .agent-list { list-style: none; padding: 0; margin: 0.7rem 0 0 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .agent-card {
    background: var(--bg, white); border: 1px solid var(--line-soft, #e0e0e0);
    border-left-width: 4px; border-radius: 0.45rem; padding: 0.6rem 0.8rem;
  }
  .agent-card.cli-codex { border-left-color: #4a6cf7; }
  .agent-card.cli-pi { border-left-color: #c44a9b; }
  .agent-head { display: flex; gap: 0.55rem; align-items: baseline; }
  .agent-badge { font-size: 0.7rem; font-weight: 800; padding: 0.08rem 0.4rem; border-radius: 0.25rem; background: var(--bg, #f0f0f0); text-transform: uppercase; }
  .agent-id { font-family: ui-monospace, monospace; font-size: 0.78rem; color: var(--ink-soft, #555); }
  .agent-age { margin-left: auto; font-size: 0.75rem; color: var(--ink-soft, #777); }
  .agent-meta { display: flex; gap: 0.7rem; font-size: 0.78rem; color: var(--ink-soft, #666); margin-top: 0.3rem; flex-wrap: wrap; }
  .agent-meta code { font-family: ui-monospace, monospace; font-size: 0.74rem; }
  .agent-prompt { margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px dashed var(--line-soft, #e0e0e0); display: flex; flex-direction: column; gap: 0.35rem; }
  .prompt-label { font-size: 0.7rem; color: var(--ink-soft, #777); text-transform: uppercase; letter-spacing: 0.04em; }
  .agent-prompt textarea {
    width: 100%; resize: vertical; min-height: 3.5rem;
    padding: 0.4rem 0.55rem; font-family: ui-monospace, monospace; font-size: 0.82rem;
    border: 1px solid var(--line-soft, #ccc); border-radius: 0.3rem;
    background: var(--bg, white); color: inherit;
  }
  .agent-prompt textarea:focus { outline: 2px solid var(--accent, #4a6cf7); outline-offset: 1px; }
  .prompt-row { display: flex; gap: 0.55rem; align-items: center; }
  .action-btn { padding: 0.3rem 0.65rem; font-size: 0.78rem; border: 1px solid var(--line-soft, #ccc); background: var(--bg, white); border-radius: 0.3rem; cursor: pointer; }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .prompt-send { font-weight: 700; }
  .prompt-status { font-size: 0.76rem; color: var(--ink-soft, #777); }
  .agent-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
  .action-btn.danger { color: var(--accent, #c63b3b); border-color: var(--accent, #c63b3b); }
</style>
