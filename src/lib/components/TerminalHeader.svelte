<!--
  TerminalHeader.svelte — FRONT-1 per docs/terminal-t2-frontend-design-2026-05-14.md.
  Owns: inline-editable userName, 3 view-mode chips (Chat/ANT/Raw), status dot.
  sessionId is intentionally hidden per JWPK Q1 lock.
-->
<script lang="ts">
  import { agentKinds } from '$lib/stores/agentKinds.svelte';
  import AgentDot from './AgentDot.svelte';
  import type { AgentDotState } from '$lib/shared/agent-status';
  type ViewMode = 'chat' | 'ant' | 'raw';
  type Status = 'active' | 'idle' | 'killed';

  // AgentKind is a string union of known fingerprintable agents PLUS
  // empty-string for "none". Widened to string for forward-compat with
  // classifier output that may emit unknown kinds (rendered as plain
  // text in the select; user can still pick known kinds explicitly).
  type AgentKind = string;

  type Props = {
    userName: string;
    viewMode: ViewMode;
    status?: Status;
    routingRoomName?: string;
    agentKind?: AgentKind | null;
    agentStateLabel?: string | null;
    agentStateCwd?: string | null;
    agentStateSessionId?: string | null;
    onRename?: (next: string) => void;
    onViewChange: (mode: ViewMode) => void;
    onAgentKindChange?: (next: AgentKind) => void;
    onInterrupt?: () => void;
    onKill?: () => void;
    onOpenSettings?: () => void;
  };

  let {
    userName = $bindable(),
    viewMode,
    status = 'active',
    routingRoomName,
    agentKind,
    agentStateLabel = null,
    agentStateCwd = null,
    agentStateSessionId = null,
    onRename,
    onViewChange,
    onAgentKindChange,
    onInterrupt,
    onKill,
    onOpenSettings
  }: Props = $props();

  function dotStateFor(label: string | null, fallback: Status): AgentDotState {
    if (fallback === 'killed') return 'offline';
    const normalized = (label ?? '').toLowerCase();
    if (normalized.includes('working')) return 'active';
    if (normalized.includes('thinking')) return 'thinking';
    if (normalized.includes('response') || normalized.includes('permission') || normalized.includes('menu')) return 'active';
    if (normalized.includes('waiting') || normalized.includes('available') || normalized.includes('idle')) return 'idle';
    return fallback === 'idle' ? 'idle' : 'active';
  }

  function shortPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return '…/' + parts.slice(-2).join('/');
  }

  const dotState = $derived(dotStateFor(agentStateLabel, status));
  const stateLabelText = $derived((agentStateLabel && agentStateLabel.trim().length > 0) ? agentStateLabel.trim() : null);
  const stateTitle = $derived(agentStateSessionId ? `state session ${agentStateSessionId}` : 'agent state');

  function handleAgentKindChange(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    onAgentKindChange?.((target.value || '') as AgentKind);
  }

  let editing = $state(false);
  let draftName = $state(userName);

  function startEdit(): void {
    draftName = userName;
    editing = true;
  }

  function commitEdit(): void {
    const trimmed = draftName.trim();
    const previous = userName;
    editing = false;
    if (trimmed && trimmed !== previous) {
      // Fire onRename FIRST (synchronous, before the bindable prop reassign)
      // so the parent's PATCH handler is guaranteed to run regardless of
      // any reactivity timing on the $bindable update.
      onRename?.(trimmed);
      userName = trimmed;
    }
  }

  function cancelEdit(): void {
    draftName = userName;
    editing = false;
  }

  function handleKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') commitEdit();
    else if (ev.key === 'Escape') cancelEdit();
  }
</script>

<header class="terminal-header" aria-label="Terminal controls">
  <div class="left">
    <AgentDot
      id={agentKind ?? 'unknown'}
      state={dotState}
      size={10}
    />
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        type="text"
        bind:value={draftName}
        onblur={commitEdit}
        onkeydown={handleKey}
        autofocus
        aria-label="Edit terminal name"
      />
    {:else}
      <button type="button" class="name-button" onclick={startEdit} title="Click to rename terminal">
        <span class="name-text">{userName || 'Untitled terminal'}</span>
        <svg class="pencil" viewBox="0 0 24 24" aria-hidden="true" width="12" height="12"><path d="M14.06 9.02l.92.92L5.92 19H5v-.92zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83a.996.996 0 000-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94z" fill="currentColor"/></svg>
      </button>
    {/if}
    {#if routingRoomName}
      <span class="routing-pill" title="Output forwards to room">↳ {routingRoomName}</span>
    {/if}
    <select class="agent-kind" aria-label="Agent kind" value={agentKind ?? ''} onchange={handleAgentKindChange}>
      <option value="">— none (raw PTY) —</option>
      {#each agentKinds.enabled as kind (kind)}
        <option value={kind}>{kind}</option>
      {/each}
    </select>
    {#if stateLabelText}
      <span class="state-pill" title={stateTitle}>{stateLabelText}</span>
    {/if}
    {#if agentStateCwd}
      <span class="cwd-pill" title={agentStateCwd}>cwd {shortPath(agentStateCwd)}</span>
    {/if}
  </div>

  <nav class="view-switcher" aria-label="View mode">
    <button type="button" class="chip" class:active={viewMode === 'chat'} onclick={() => onViewChange('chat')} aria-pressed={viewMode === 'chat'}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      Chat
    </button>
    <button type="button" class="chip" class:active={viewMode === 'ant'} onclick={() => onViewChange('ant')} aria-pressed={viewMode === 'ant'}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><circle cx="12" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="3" ry="2.4" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="18" rx="3.4" ry="2.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      ANT
    </button>
    <button type="button" class="chip" class:active={viewMode === 'raw'} onclick={() => onViewChange('raw')} aria-pressed={viewMode === 'raw'}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 10l3 2-3 2M12 14h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Raw
    </button>
  </nav>
  {#if onOpenSettings && status !== 'killed'}
    <button
      type="button"
      class="settings-btn"
      onclick={onOpenSettings}
      title="Terminal settings — write access, persistence, only-respond"
      aria-label="Open terminal settings"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
        <path d="M19.4 13.6a7.8 7.8 0 0 0 0-3.2l2-1.5-2-3.5-2.4.9a7.7 7.7 0 0 0-2.8-1.6L13.7 2h-4l-.4 2.7A7.7 7.7 0 0 0 6.4 6.3L4 5.4l-2 3.5 2 1.5a7.8 7.8 0 0 0 0 3.2l-2 1.5 2 3.5 2.4-.9a7.7 7.7 0 0 0 2.8 1.6l.4 2.7h4l.4-2.7a7.7 7.7 0 0 0 2.8-1.6l2.4.9 2-3.5-2-1.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    </button>
  {/if}
  {#if onInterrupt && status !== 'killed'}
    <button type="button" class="interrupt-btn" onclick={onInterrupt} title="Interrupt terminal (send Esc)" aria-label="Interrupt terminal">
      <span aria-hidden="true">🛑</span>
    </button>
  {/if}
  {#if onKill && status !== 'killed'}
    <button type="button" class="kill-btn" onclick={onKill} title="Kill terminal (destructive)" aria-label="Kill terminal">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M6 6l12 12M6 18l12-12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>
  {/if}
</header>

<style>
  .terminal-header {
    display: flex; justify-content: space-between; align-items: center;
    gap: 0.75rem; padding: 0.55rem 0.85rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.6rem 0.6rem 0 0; border-bottom: none;
    flex-wrap: wrap;
  }
  .left { display: flex; align-items: center; gap: 0.55rem; min-width: 0; flex: 1 1 auto; }
  /* Status dot now rendered by AgentDot (V3-LIFT-1) — agent colour from
     nocturne + breathing aura when state=active/thinking. */
  .name-button {
    display: inline-flex; align-items: center; gap: 0.35rem;
    background: transparent;
    border: 1px solid transparent;
    padding: 0.15rem 0.45rem;
    border-radius: 0.35rem; cursor: pointer;
    color: var(--ink-strong); font-weight: 700; font-size: 0.95rem;
    text-align: left; min-width: 0;
  }
  .name-button:hover { background: var(--bg); border-color: var(--line-soft); }
  .name-button:hover .pencil { opacity: 1; }
  .name-button .name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name-button .pencil {
    flex-shrink: 0; opacity: 0.45; color: var(--ink-soft);
    transition: opacity 0.15s;
  }
  .name-input {
    padding: 0.2rem 0.4rem; border: 1px solid var(--accent);
    border-radius: 0.35rem; background: var(--bg); color: var(--ink-strong);
    font-weight: 700; font-size: 0.95rem; min-width: 8rem;
  }
  .routing-pill {
    padding: 0.15rem 0.5rem; border-radius: 999px;
    background: var(--bg); color: var(--ink-soft);
    font-size: 0.75rem; font-family: ui-monospace, monospace;
  }
  .agent-kind {
    padding: 0.2rem 0.45rem; border-radius: 0.35rem;
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.78rem;
  }
  .agent-kind:hover { border-color: var(--ink-soft); }
  .state-pill,
  .cwd-pill {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-soft);
    font-family: ui-monospace, monospace;
    font-size: 0.74rem;
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state-pill {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line-soft));
  }
  .cwd-pill { max-width: 22rem; }
  .settings-btn,
  .interrupt-btn,
  .kill-btn {
    margin-left: 0.4rem;
    width: 1.7rem; height: 1.7rem; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid transparent; border-radius: 50%;
    background: transparent; color: var(--ink-soft); cursor: pointer;
  }
  .settings-btn:hover { color: var(--ink-strong); border-color: var(--ink-strong); background: var(--bg); }
  .interrupt-btn {
    color: var(--accent, #c63b3b);
    opacity: 0.78;
  }
  .interrupt-btn:hover { border-color: var(--accent, #c63b3b); background: var(--bg); opacity: 1; }
  .kill-btn:hover { color: var(--accent, #c63b3b); border-color: var(--accent, #c63b3b); background: var(--bg); }
  .view-switcher { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.3rem 0.6rem; border: 1px solid var(--line-soft);
    border-radius: 999px; background: var(--bg); color: var(--ink-soft);
    font-size: 0.8rem; font-weight: 700; cursor: pointer;
  }
  .chip:hover { color: var(--ink-strong); border-color: var(--ink-soft); }
  .chip.active {
    color: var(--accent); border-color: var(--accent);
    background: var(--surface-card);
  }
</style>
