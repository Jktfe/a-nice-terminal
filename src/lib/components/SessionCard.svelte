<script lang="ts">
  import { NOCTURNE, agentColorFromSession } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';
  import { agentDotStateFromStatus } from '$lib/shared/agent-status';
  import { deriveTerminalActivityState } from '$lib/shared/terminal-activity';

  let { session, onclick, onArchive, onDelete } = $props();

  let hover = $state(false);

  const isTerminal = $derived(session.type === 'terminal');
  const agent = $derived(agentColorFromSession(session));
  const agentId = $derived(session.cli_flag || session.handle?.replace('@', '') || null);

  function timeAgo(dateStr: string) {
    const utc = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const diff = Date.now() - new Date(utc).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function deriveStatus(s: typeof session) {
    if (s.attention_state === 'focus') {
      return { color: NOCTURNE.amber[400], label: 'Focus' };
    }
    if (s.type === 'terminal' && s.last_activity) {
      const activity = deriveTerminalActivityState(s.last_activity);
      if (activity.state === 'working')  return { color: NOCTURNE.emerald[400], label: 'Working' };
      if (activity.state === 'thinking') return { color: NOCTURNE.amber[400], label: 'Thinking' };
    }
    const statusMap: Record<string, { color: string; label: string }> = {
      active:    { color: NOCTURNE.emerald[400], label: 'Active' },
      idle:      { color: NOCTURNE.ink[300], label: 'Idle' },
      completed: { color: NOCTURNE.blue[400], label: 'Completed' },
    };
    return statusMap[s.status] || { color: NOCTURNE.ink[300], label: s.status || 'Idle' };
  }

  const statusInfo = $derived(deriveStatus(session));
  const agentDotState = $derived(agentDotStateFromStatus(null, {
    focus: session.attention_state === 'focus',
    sessionStatus: statusInfo.label.toLowerCase(),
  }));

  function handleDelete(e: MouseEvent) { e.stopPropagation(); onDelete?.(); }
  function handleArchive(e: MouseEvent) { e.stopPropagation(); onArchive?.(); }
</script>

<!--
  Render as <a href> so right-click → "Open in new tab" works. SvelteKit
  intercepts left-click for SPA navigation, so the parent's onclick (which
  may do extra bookkeeping) still fires; modifier-clicks and right-click
  hand off to the browser as expected.
-->
<a
  class="group relative overflow-hidden cursor-pointer"
  href="/session/{session.id}"
  style="
    display: block;
    text-decoration: none;
    color: var(--text);
    background: var(--surface-elev);
    border-radius: var(--radius-card);
    padding: 12px 14px 10px;
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-body);
    box-shadow: inset 0 0 0 0.5px var(--hairline-strong),
      0 1px 0 rgba(0,0,0,0.02),
      0 8px 24px -18px rgba(0,0,0,{hover ? 0.16 : 0.06});
    transform: translateY({hover ? -1 : 0}px);
    transition: transform var(--duration-base) var(--spring-quick),
                box-shadow var(--duration-base) var(--spring-default);
  "
  onclick={onclick}
  onmouseenter={() => hover = true}
  onmouseleave={() => hover = false}
>
  <!-- Interior glow -->
  <div
    aria-hidden="true"
    class="absolute inset-0 rounded-[inherit] pointer-events-none"
    style="
      background: radial-gradient(70% 90% at 50% -10%, {agent.color}14 0%, transparent 60%);
      opacity: {hover ? 1 : 0.6};
      transition: opacity var(--duration-slow) var(--spring-default);
    "
  ></div>

  <!-- Top row -->
  <div class="relative flex items-center gap-2.5">
    <!-- Type glyph + agent dot -->
    <div class="flex-shrink-0 relative" style="width: 18px; height: 18px;">
      {#if agentId}
        <AgentDot id={agentId} size={14} state={agentDotState} />
      {:else}
        <div
          class="flex items-center justify-center rounded-full"
          style="
            width: 18px; height: 18px;
            background: {isTerminal ? NOCTURNE.emerald[500] + '22' : NOCTURNE.blue[500] + '22'};
            color: {isTerminal ? NOCTURNE.emerald[400] : NOCTURNE.blue[400]};
            font-size: 11px; font-weight: 700;
          "
        >{isTerminal ? '>' : '#'}</div>
      {/if}
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="font-semibold text-sm truncate" style="letter-spacing: -0.01em;">{session.name}</span>
        {#if session.handle}
          <span
            style="
              font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0;
              color: {agent.color}99; background: {agent.color}18;
              padding: 1px 5px; border-radius: 4px; white-space: nowrap;
            "
          >{session.handle}</span>
        {/if}
        {#if session.attention_state === 'focus'}
          <span
            class="font-mono uppercase"
            style="
              font-size: 9.5px; letter-spacing: 0;
              color: {NOCTURNE.amber[700]}; background: {NOCTURNE.amber[300]}33;
              border: 0.5px solid {NOCTURNE.amber[400]}66;
              padding: 1px 5px; border-radius: 4px; white-space: nowrap;
            "
            title={session.attention_reason || `Focus mode${session.focus_room_name ? ` in ${session.focus_room_name}` : ''}`}
          >FOCUS</span>
        {/if}
      </div>
      <div class="flex items-center gap-1.5 mt-0.5" style="font-size: 11.5px; font-family: var(--font-mono); letter-spacing: 0; color: var(--text-muted);">
        <span>{isTerminal ? 'terminal' : 'chat'}</span>
        <div class="rounded-full" style="width: 3px; height: 3px; background: var(--text-faint);"></div>
        <div class="flex items-center gap-1">
          <div
            class="rounded-full"
            style="
              width: 6px; height: 6px;
              background: {statusInfo.color};
              box-shadow: {statusInfo.label === 'Active' ? `0 0 8px ${statusInfo.color}` : 'none'};
            "
          ></div>
          <span>{statusInfo.label}</span>
        </div>
        {#if session.attention_state === 'focus'}
          <div class="rounded-full" style="width: 3px; height: 3px; background: var(--text-faint);"></div>
          <span title={session.attention_reason || ''}>
            {session.focus_queue_count || 0} queued
          </span>
        {/if}
      </div>
    </div>

    <!-- Time + Actions -->
    <div class="flex items-center gap-2 flex-shrink-0">
      {#if session.ttl === 'forever'}
        <span
          class="group-hover:hidden"
          style="font-family: var(--font-mono); font-size: 10.5px; color: {NOCTURNE.emerald[400]}; background: {NOCTURNE.emerald[500]}18; border: 0.5px solid {NOCTURNE.emerald[500]}30; padding: 2px 6px; border-radius: 5px;"
        >AON</span>
      {:else}
        <span
          class="group-hover:hidden"
          style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); letter-spacing: 0; font-variant-numeric: tabular-nums;"
        >{timeAgo(session.updated_at)}</span>
      {/if}

      <!-- Hover actions -->
      <div class="hidden group-hover:flex items-center gap-1">
        <button
          onclick={handleArchive}
          class="p-1.5 rounded cursor-pointer"
          style="color: var(--text-faint); background: transparent; border: none;"
          title="Archive"
        >
          <NocturneIcon name="check" size={14} />
        </button>
        <button
          onclick={handleDelete}
          class="p-1.5 rounded cursor-pointer"
          style="color: {NOCTURNE.semantic.danger}; background: transparent; border: none;"
          title="Delete"
        >
          <NocturneIcon name="x" size={14} />
        </button>
      </div>
    </div>
  </div>
</a>
