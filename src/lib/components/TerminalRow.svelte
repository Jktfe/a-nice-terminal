<script lang="ts">
  import { goto } from '$app/navigation';
  import { deriveTerminalActivityState } from '$lib/shared/terminal-activity';
  import { useToasts } from '$lib/stores/toast.svelte';
  import type { Session } from '$lib/stores/sessions.svelte';

  let {
    terminal,
    linkedChat = null,
    needsInput = null,
    idleAttention = false,
    onArchive,
    onDelete,
  }: {
    terminal: Session;
    linkedChat?: Session | null;
    needsInput?: { eventClass: string; summary: string } | null;
    idleAttention?: boolean;
    onArchive?: () => void;
    onDelete?: () => void;
  } = $props();

  const toasts = useToasts();

  let messageText = $state('');
  let sending = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);

  // Derive terminal active/idle status from last_activity
  const terminalStatus = $derived((() => {
    if (terminal.attention_state === 'focus') {
      return { label: 'FOCUS', color: '#92400E', bg: 'rgba(245,158,11,0.16)' };
    }
    if (terminal.last_activity) {
      const activity = deriveTerminalActivityState(terminal.last_activity);
      if (activity.state === 'working')  return { label: 'WORKING', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' };
      if (activity.state === 'thinking') return { label: 'THINKING', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
    }
    const s = terminal.status ?? 'idle';
    if (s === 'active') return { label: 'ACTIVE', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' };
    return { label: 'IDLE', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
  })());

  const driverLabel = $derived.by(() => {
    const meta = parseMeta(terminal.meta);
    const driver = (meta.agent_driver as string | undefined) ?? terminal.cli_flag ?? null;
    const mode = meta.driver_mode as string | undefined;
    return [driver, mode].filter(Boolean).join(' · ');
  });

  const lastActivityAgo = $derived.by(() => {
    const value = linkedChat?.last_activity ?? terminal.last_activity;
    return value ? timeAgo(value) : '';
  });

  function parseMeta(meta: unknown): Record<string, unknown> {
    if (!meta) return {};
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof meta === 'object' ? meta as Record<string, unknown> : {};
  }

  function timeAgo(value: string): string {
    if (!value) return '';
    const normalized = value.includes('Z') || value.includes('+') ? value : value.replace(' ', 'T') + 'Z';
    const ts = new Date(normalized).getTime();
    if (!ts) return '';
    const diff = Math.max(0, Date.now() - ts);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.floor(h / 24);
    return `${d} d ago`;
  }

  function handleCardClick() {
    goto(`/session/${terminal.id}`);
  }

  function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    onArchive?.();
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete?.();
  }

  async function handleSend(e?: MouseEvent | KeyboardEvent) {
    e?.stopPropagation();
    const text = messageText.trim();
    if (!text || sending) return;
    if (!linkedChat?.id) {
      toasts.show('Link a chat first to send messages from the dashboard', 'error');
      return;
    }
    sending = true;
    try {
      const res = await fetch(`/api/sessions/${linkedChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: text, format: 'text', msg_type: 'message' }),
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
      messageText = '';
      resizeInput();
    } catch (err) {
      toasts.show(err instanceof Error ? err.message : 'Failed to send', 'error');
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e);
    }
  }

  function resizeInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-row group"
  onclick={handleCardClick}
>
  <!-- Pin icon (always-on terminals) -->
  <div class="row-pin" title={terminal.ttl === 'forever' ? 'Always On' : ''}>
    {#if terminal.ttl === 'forever'}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 17v5"/>
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
      </svg>
    {/if}
  </div>

  <!-- Left: terminal info -->
  <div class="row-left">
    <svg class="row-prompt" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
    <div class="row-left__text">
      <div class="row-left__title">
        <span class="row-left__name">{terminal.name}</span>
        <span class="row-status" style="color: {terminalStatus.color}; background: {terminalStatus.bg};">
          {terminalStatus.label}
        </span>
        {#if needsInput}
          <span class="row-status row-status--pulse" style="color:#EF4444;background:rgba(239,68,68,0.12);" title={needsInput.summary}>
            <span class="ant-pulse-dot" style="width:6px;height:6px;border-radius:50%;background:#EF4444;display:inline-block;"></span>
            NEEDS INPUT
          </span>
        {:else if idleAttention}
          <span class="row-status" style="color:#F59E0B;background:rgba(245,158,11,0.08);" title="Terminal has been idle">
            <span style="width:5px;height:5px;border-radius:50%;background:#F59E0B;display:inline-block;opacity:0.6;"></span>
            IDLE
          </span>
        {/if}
      </div>
      {#if driverLabel}
        <div class="row-left__driver">{driverLabel}</div>
      {/if}
    </div>
  </div>

  <!-- Divider -->
  <div class="row-divider"></div>

  <!-- Right: inline send box + meta -->
  <div class="row-right" onclick={(e) => e.stopPropagation()}>
    <div class="send-line">
      <svg class="send-line__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <textarea
        bind:this={inputEl}
        class="send-line__input"
        bind:value={messageText}
        oninput={resizeInput}
        onkeydown={handleKeydown}
        placeholder={linkedChat ? 'Message…' : 'Link a chat to send…'}
        disabled={!linkedChat || sending}
        rows="1"
      ></textarea>
      <button
        type="button"
        class="send-line__btn"
        onclick={handleSend}
        disabled={!linkedChat || sending || !messageText.trim()}
        title={linkedChat ? 'Send to linked chat' : 'No linked chat'}
        aria-label="Send"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 2 11 13"/>
          <path d="m22 2-7 20-4-9-9-4 20-7z"/>
        </svg>
      </button>
    </div>
    {#if lastActivityAgo}
      <div class="row-meta">{lastActivityAgo}</div>
    {/if}
  </div>

  <!-- Hover action buttons -->
  <div class="row-actions" onclick={(e) => e.stopPropagation()}>
    {#if onArchive}
      <button
        type="button"
        class="row-action row-action--archive"
        onclick={handleArchive}
        title="Archive"
        aria-label="Archive {terminal.name}"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="5" rx="1"/>
          <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/>
          <path d="M10 13h4"/>
        </svg>
      </button>
    {/if}
    {#if onDelete}
      <button
        type="button"
        class="row-action row-action--delete"
        onclick={handleDelete}
        title="Delete"
        aria-label="Delete {terminal.name}"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .terminal-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 1px minmax(0, 1.1fr);
    align-items: center;
    column-gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--border-light);
    border-radius: 12px;
    background: var(--bg-card);
    cursor: pointer;
    position: relative;
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .terminal-row:hover {
    border-color: var(--border-subtle);
    background: var(--bg-elevated, var(--bg-card));
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
  }

  .row-pin {
    width: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
  }

  .row-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .row-prompt {
    color: #4F46E5;
    flex-shrink: 0;
  }

  .row-left__text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-left__title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .row-left__name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-left__driver {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
  }

  .row-divider {
    align-self: stretch;
    background: var(--border-light);
    margin: 4px 0;
  }

  .row-right {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .send-line {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    border: 1px solid var(--border-light);
    border-radius: 9px;
    background: var(--bg);
  }

  .send-line:focus-within {
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
  }

  .send-line__icon {
    color: #6366F1;
    flex-shrink: 0;
  }

  .send-line__input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    color: var(--text);
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    padding: 4px 0;
    max-height: 120px;
  }

  .send-line__input:disabled {
    color: var(--text-faint);
    cursor: not-allowed;
  }

  .send-line__btn {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    flex-shrink: 0;
  }

  .send-line__btn:not(:disabled):hover {
    color: #6366F1;
    background: rgba(99, 102, 241, 0.1);
  }

  .send-line__btn:disabled {
    color: var(--text-faint);
    cursor: not-allowed;
    opacity: 0.5;
  }

  .row-meta {
    font-size: 11px;
    color: var(--text-faint);
    padding-left: 22px;
    line-height: 1.2;
  }

  .row-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: none;
    gap: 4px;
  }

  .terminal-row:hover .row-actions { display: flex; }

  .row-action {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: var(--bg-elevated, var(--bg-card));
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .row-action--archive:hover { color: var(--text); background: var(--bg-card); }
  .row-action--delete:hover { color: #EF4444; background: rgba(239, 68, 68, 0.12); }

  :global(.ant-pulse-dot) {
    animation: ant-pulse 1.5s ease-in-out infinite;
  }

  @keyframes ant-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.4); }
  }

  @media (max-width: 720px) {
    .terminal-row {
      grid-template-columns: 28px minmax(0, 1fr);
      grid-template-rows: auto auto;
      row-gap: 8px;
    }
    .row-divider { display: none; }
    .row-right { grid-column: 1 / -1; }
  }
</style>
