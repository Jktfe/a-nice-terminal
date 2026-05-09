<script lang="ts">
  import { NOCTURNE, agentColor, agentColorFromSession } from '$lib/nocturne';
  import { agentDotStateFromStatus, type AgentStatus as TelemetryAgentStatus } from '$lib/shared/agent-status';
  import { getAgentStatus as getLiveAgentStatus } from '$lib/stores/agent-status.svelte';
  import { renderChatMarkdown } from '$lib/markdown/chat-markdown';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';

  let {
    message,
    sessionId,
    allSessions = [],
    readReceipts = [],
    replyMessage = null,
    agentStatus = null,
    agentNeedsInput = false,
    onReply,
    onInterview,
    onDeleted,
    onMetaUpdated,
    onPinToggled,
  }: {
    message: any;
    sessionId: string;
    allSessions?: any[];
    readReceipts?: { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }[];
    replyMessage?: any;
    agentStatus?: TelemetryAgentStatus | null;
    agentNeedsInput?: boolean;
    onReply?: (msg: any) => void;
    /** Open an interview dialog rooted at this message. The handler
     *  receives the source message so the modal can derive the target
     *  agent (its sender_id) and the parent room/message for transcript
     *  + summary post-back wiring. Eligibility (only render the chip
     *  when the message has an agent author) lives in the consumer. */
    onInterview?: (msg: any) => void;
    onDeleted?: (id: string) => void;
    onMetaUpdated?: (id: string, meta: any) => void;
    onPinToggled?: (id: string, pinned: boolean) => void;
  } = $props();

  let hover = $state(false);

  const isOwn = $derived(!message.sender_id && (message.role === 'user' || message.role === 'human'));
  const isAi  = $derived(!message.sender_id && message.role !== 'user' && message.role !== 'human');
  const handle = $derived(message.sender_id || null);

  function unresolvedSenderLabel(senderId: string): string {
    return `Session ${senderId.slice(0, 8)}`;
  }

  const resolvedSession = $derived(
    handle ? allSessions.find((s: any) => s.id === handle || s.handle === handle || s.alias === handle) : null
  );

  // Agent identity from Nocturne palette
  const agentIdentity = $derived(
    handle
      ? agentColorFromSession(resolvedSession)
      : isAi
        ? agentColor('claude')
        : { color: NOCTURNE.ink[200], glow: NOCTURNE.ink[100] }
  );

  const colour = $derived(agentIdentity.color);

  // Derive the agent ID for AgentDot (cli_flag or handle)
  const agentId = $derived(
    resolvedSession?.cli_flag || resolvedSession?.handle?.replace('@', '') || (isAi ? 'claude' : null)
  );

  function newestAgentStatus(
    fallback: TelemetryAgentStatus | null | undefined,
    live: TelemetryAgentStatus | null | undefined,
  ): TelemetryAgentStatus | null {
    if (!fallback) return live ?? null;
    if (!live) return fallback;
    return live.detectedAt > fallback.detectedAt ? live : fallback;
  }

  const liveAgentStatus = $derived(getLiveAgentStatus(resolvedSession?.id));
  const effectiveAgentStatus = $derived(newestAgentStatus(agentStatus, liveAgentStatus));
  const agentDotState = $derived(agentDotStateFromStatus(effectiveAgentStatus, {
    needsInput: agentNeedsInput,
    sessionStatus: resolvedSession?.status ?? null,
    focus: resolvedSession?.attention_state === 'focus',
  }));

  const displayName = $derived(
    resolvedSession ? (resolvedSession.display_name || resolvedSession.name) :
    handle          ? (handle.startsWith('@') ? handle : unresolvedSenderLabel(handle)) :
    isAi            ? 'Assistant' : 'James'
  );

  const avatarInitial = $derived(
    displayName.replace('@', '').slice(0, 1).toUpperCase()
  );

  function resolveReader(reader: { session_id: string; reader_name: string; reader_handle: string | null }) {
    return allSessions.find((s: any) =>
      s.id === reader.session_id ||
      s.handle === reader.reader_handle ||
      s.alias === reader.reader_handle ||
      s.name === reader.reader_name ||
      s.display_name === reader.reader_name
    ) ?? null;
  }

  function readerLabel(reader: { session_id: string; reader_name: string; reader_handle: string | null }): string {
    const sess = resolveReader(reader);
    if (sess) return sess.display_name || sess.name || sess.handle || reader.reader_name || reader.session_id;
    return reader.reader_handle || reader.reader_name || `Session ${reader.session_id.slice(0, 8)}`;
  }

  function readerTitle(reader: { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }): string {
    const sess = resolveReader(reader);
    const label = readerLabel(reader);
    const handleText = sess?.handle && sess.handle !== label ? ` (${sess.handle})` : '';
    const readAt = reader.read_at ? new Date(reader.read_at.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    return `${label}${handleText} saw this${readAt ? ` at ${readAt}` : ''}`;
  }

  function readerColor(reader: { session_id: string; reader_name: string; reader_handle: string | null }): string {
    const sess = resolveReader(reader);
    return sess
      ? agentColorFromSession(sess).color
      : agentColor(reader.reader_handle || reader.reader_name || reader.session_id).color;
  }

  const visibleReadReceipts = $derived.by(() => {
    if (isOwn) return [];
    return readReceipts.filter((reader) =>
      reader.session_id !== sessionId &&
      reader.session_id !== message.sender_id
    );
  });

  // Timestamp
  const timeStr = $derived.by(() => {
    if (!message.created_at) return '';
    const utc = message.created_at.includes('Z') || message.created_at.includes('+')
      ? message.created_at
      : message.created_at.replace(' ', 'T') + 'Z';
    return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  // "Agent active since Ns ago" footnote — appears when the agent has done
  // at least one tool invocation AFTER this message was posted (i.e.
  // status.timestamps.editAt is more recent than message.created_at).
  // Signals that the conversation has moved past this message and any
  // attention-needed flags it carried may now be stale.
  const messageCreatedMs = $derived.by(() => {
    if (!message.created_at) return null;
    const utc = message.created_at.includes('Z') || message.created_at.includes('+')
      ? message.created_at
      : message.created_at.replace(' ', 'T') + 'Z';
    const ms = Date.parse(utc);
    return Number.isFinite(ms) ? ms : null;
  });
  const agentEditedAfterMs = $derived.by(() => {
    const isAgent = message.role === 'assistant';
    if (!isAgent) return null;
    const editAt = effectiveAgentStatus?.timestamps?.editAt;
    if (!editAt || !messageCreatedMs) return null;
    if (editAt <= messageCreatedMs) return null;
    return editAt;
  });
  const agentEditedAgo = $derived.by(() => {
    if (!agentEditedAfterMs) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - agentEditedAfterMs) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const m = Math.floor(diffSec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  });

  const targetBadge = $derived(
    message.target && message.target !== '@everyone' ? message.target : null
  );

  // Reply context
  const replyHandle = $derived(replyMessage?.sender_id || null);
  const replySession = $derived(
    replyHandle ? allSessions.find((s: any) => s.id === replyHandle || s.handle === replyHandle || s.alias === replyHandle) : null
  );
  const replyDisplayName = $derived(
    replySession ? (replySession.display_name || replySession.name) :
    replyHandle  ? (replyHandle.startsWith('@') ? replyHandle : unresolvedSenderLabel(replyHandle)) :
    replyMessage ? (replyMessage.role === 'assistant' ? 'Assistant' : 'You') : ''
  );
  const replySnippet = $derived((replyMessage?.content || '').replace(/\s+/g, ' ').trim().slice(0, 120));
  const renderedContent = $derived(renderChatMarkdown(message.content));

  // Parse meta
  let parsedMeta = $derived.by(() => {
    try { return JSON.parse(message.meta || '{}'); } catch { return {}; }
  });
  const reactions = $derived(parsedMeta.reactions ?? { up: 0, down: 0 });
  const bookmarked = $derived(!!parsedMeta.bookmarked);
  const pinned = $derived(!!message.pinned);

  // --- Actions ---
  async function react(kind: 'up' | 'down') {
    const current = reactions[kind] ?? 0;
    const newMeta = { ...parsedMeta, reactions: { ...reactions, [kind]: current + 1 } };
    const res = await fetch(`/api/sessions/${sessionId}/messages?msgId=${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { reactions: newMeta.reactions } }),
    });
    if (res.ok) {
      const data = await res.json();
      onMetaUpdated?.(message.id, data.meta);
    }
  }

  async function toggleBookmark() {
    const newBookmarked = !bookmarked;
    if (newBookmarked) {
      const note = message.content.slice(0, 80).replace(/\n/g, ' ');
      await fetch(`/api/sessions/${sessionId}/file-refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: `msg:${message.id}`, note: `💬 ${note}`, flagged_by: handle || 'web' }),
      });
    }
    const res = await fetch(`/api/sessions/${sessionId}/messages?msgId=${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { bookmarked: newBookmarked } }),
    });
    if (res.ok) {
      const data = await res.json();
      onMetaUpdated?.(message.id, data.meta);
    }
  }

  // B6 — two-step confirm. First click arms; second click within DELETE_CONFIRM_MS
  // commits. Mouse leaving the action row or the timeout firing reverts to neutral.
  // Pattern chosen over optimistic-delete-with-undo because in-place confirm needs
  // zero server coupling — the existing DELETE endpoint is unchanged.
  const DELETE_CONFIRM_MS = 3000;
  let deleteArmedAt = $state<number | null>(null);
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
  const deleteArmed = $derived(deleteArmedAt !== null);

  function disarmDelete() {
    deleteArmedAt = null;
    if (deleteTimer) {
      clearTimeout(deleteTimer);
      deleteTimer = null;
    }
  }

  async function deleteMsg() {
    if (!deleteArmed) {
      deleteArmedAt = Date.now();
      if (deleteTimer) clearTimeout(deleteTimer);
      deleteTimer = setTimeout(() => { disarmDelete(); }, DELETE_CONFIRM_MS);
      return;
    }
    disarmDelete();
    await fetch(`/api/sessions/${sessionId}/messages?msgId=${message.id}`, { method: 'DELETE' });
    onDeleted?.(message.id);
  }

  async function togglePin() {
    const newPinned = !pinned;
    const res = await fetch(`/api/sessions/${sessionId}/messages/${message.id}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: newPinned }),
    });
    if (res.ok) {
      const data = await res.json();
      onPinToggled?.(message.id, data.pinned);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group relative"
  style="
    padding: 12px 18px 14px;
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-body);
    color: var(--text);
    border-radius: var(--radius-card);
    background: {hover ? 'var(--hairline)' : 'transparent'};
    transition: background var(--duration-base) var(--spring-default);
  "
  onmouseenter={() => hover = true}
  onmouseleave={() => { hover = false; if (deleteArmed) disarmDelete(); }}
>
  <!-- Identity strip -->
  <div class="flex items-center gap-2.5 mb-1.5">
    {#if isOwn}
      <!-- User avatar -->
      <div
        class="flex-shrink-0 flex items-center justify-center rounded-full"
        style="
          width: 18px; height: 18px;
          background: linear-gradient(135deg, var(--text-faint), var(--text-muted));
          font-size: 9.5px; font-weight: 700; color: var(--bg);
          letter-spacing: 0;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
        "
      >{avatarInitial}</div>
    {:else}
      <!-- Agent/participant dot -->
      <div class="relative flex-shrink-0 flex items-center justify-center" style="width: 18px; height: 18px;">
        {#if agentId}
          <AgentDot id={agentId} size={12} state={agentDotState} />
        {:else}
          <div class="rounded-full" style="width: 12px; height: 12px; background: {colour}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);"></div>
        {/if}
      </div>
    {/if}

    <span style="font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: {isOwn ? 'var(--text)' : colour};">
      {displayName}
    </span>

    {#if targetBadge}
      <span style="font-size: 10px; color: var(--text-faint);">→
        <span style="font-family: var(--font-mono); color: {colour}88;">{targetBadge}</span>
      </span>
    {/if}

    {#if bookmarked}
      <span style="font-size: 10px;" title="Bookmarked">🔖</span>
    {/if}
    {#if pinned}
      <span style="font-size: 10px;" title="Pinned">📌</span>
    {/if}

    <div class="flex-1"></div>

    {#if agentEditedAfterMs}
      <span
        title="The agent has done tool work since posting this message ({new Date(agentEditedAfterMs).toLocaleTimeString()})"
        style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; letter-spacing: 0; opacity: 0.7;"
      >
        ✎ {agentEditedAgo}
      </span>
    {/if}

    <span style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; letter-spacing: 0;">
      {timeStr}
    </span>
  </div>

  <!-- Body -->
  <div style="padding-left: 28px;">
    {#if replyMessage}
      <button
        type="button"
        onclick={() => onReply?.(replyMessage)}
        class="w-full text-left mb-2 px-2.5 py-2 rounded-lg transition-colors"
        style="
          background: var(--hairline);
          border: 0.5px solid var(--hairline-strong);
          border-left: 2px solid {colour};
        "
      >
        <div style="font-size: 10px; font-weight: 600; margin-bottom: 2px; color: {colour};">Replying to {replyDisplayName}</div>
        <div style="font-size: 12px; color: var(--text-muted);" class="break-words">{replySnippet}</div>
      </button>
    {/if}

    <div
      class="message-markdown prose prose-sm break-words max-w-none
        [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
        [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5
        [&_strong]:font-semibold
        [&_code]:px-1 [&_code]:py-px [&_code]:rounded [&_code]:text-xs
        [&_pre]:my-1 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-xs
        [&_img]:my-2 [&_img]:max-w-full [&_img]:max-h-[420px] [&_img]:rounded-lg [&_img]:border [&_img]:border-gray-200 [&_img]:object-contain"
      style="
        font-size: 14px; line-height: 1.55; color: var(--text);
        --tw-prose-body: var(--text); --tw-prose-headings: var(--text);
        --tw-prose-bold: var(--text); --tw-prose-code: var(--text);
        --tw-prose-bullets: var(--text-muted);
      "
    >
      {@html renderedContent}
    </div>

    {#if message.status === 'streaming'}
      <span class="animate-caret inline-block" style="width: 8px; height: 16px; background: {NOCTURNE.emerald[400]}; vertical-align: text-bottom;"></span>
    {/if}
  </div>

  <!-- Reactions -->
  {#if reactions.up > 0 || reactions.down > 0}
    <div class="flex gap-1.5 mt-1 pl-7">
      {#if reactions.up > 0}
        <span class="text-[11px] px-1.5 py-0.5 rounded-full" style="background: var(--hairline); border: 0.5px solid var(--hairline-strong);">
          👍 {reactions.up}
        </span>
      {/if}
      {#if reactions.down > 0}
        <span class="text-[11px] px-1.5 py-0.5 rounded-full" style="background: var(--hairline); border: 0.5px solid var(--hairline-strong);">
          👎 {reactions.down}
        </span>
      {/if}
    </div>
  {/if}

  <!-- Read receipts -->
  {#if visibleReadReceipts.length > 0}
    <div class="flex items-center gap-0.5 mt-1 pl-7">
      {#each visibleReadReceipts as reader}
        {@const rc = readerColor(reader)}
        {@const title = readerTitle(reader)}
        <button
          type="button"
          class="touch-target group/receipt relative inline-flex items-center justify-center rounded-full outline-none"
          style="background: transparent; border: 0; padding: 0;"
          aria-label={title}
        >
          <span
            class="w-2.5 h-2.5 rounded-full"
            style="background: {rc}; border: 1px solid var(--bg); box-shadow: 0 0 0 1px var(--hairline-strong);"
          ></span>
          <span
            class="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 opacity-0 shadow-lg transition-opacity duration-100 group-hover/receipt:opacity-100 group-focus/receipt:opacity-100"
            style="
              background: var(--bg-card);
              border: 0.5px solid var(--hairline-strong);
              color: var(--text);
              font-family: var(--font-mono);
              font-size: 10.5px;
              letter-spacing: 0;
            "
          >{title}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Action row — hover affordances -->
  <div
    class="flex gap-1.5 pl-7 mt-2"
    style="
      opacity: {hover ? 1 : 0};
      transform: translateY({hover ? 0 : -2}px);
      transition: opacity var(--duration-base) var(--spring-quick),
                  transform var(--duration-base) var(--spring-quick);
    "
  >
    {@render actionChip('reply', 'Reply', () => onReply?.(message))}
    {#if onInterview && (message.sender_id || isAi)}
      <!-- Interview chip — only renders for messages from an agent (has
           sender_id, or is AI-role). User-sent messages can't be
           interviewed because there's no agent target to converse with.
           "mic" icon doubles as a hint that voice mode lives inside. -->
      {@render actionChip('mic', 'Interview', () => onInterview?.(message))}
    {/if}
    {@render actionChip('cornerDown', 'Thread', () => {})}
    <button
      onclick={() => react('up')}
      class="touch-target flex items-center gap-1 cursor-pointer"
      style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); background: var(--hairline); border: 0.5px solid var(--hairline-strong); padding: 4px 8px; border-radius: 6px;"
      title="React 👍"
    >👍</button>
    <!-- B6: armed state replaces the neutral chip with a danger-tinted "Confirm?" button -->
    {#if deleteArmed}
      <button
        onclick={deleteMsg}
        onmouseleave={disarmDelete}
        class="flex items-center gap-1.5 cursor-pointer"
        style="
          font-family: var(--font-mono); font-size: 11px; letter-spacing: 0;
          color: {NOCTURNE.semantic.danger};
          background: {NOCTURNE.semantic.danger}1a;
          border: 0.5px solid {NOCTURNE.semantic.danger}60;
          min-height: 44px; min-width: 44px; padding: 4px 8px; border-radius: 6px;
          transition: background var(--duration-fast);
        "
        aria-label="Confirm delete"
        title="Click again to delete · auto-cancels in 3s"
      >
        <NocturneIcon name="x" size={11} color={NOCTURNE.semantic.danger} />
        <span>Confirm?</span>
      </button>
    {:else}
      {@render actionChip('x', 'Delete', deleteMsg)}
    {/if}

    <div class="flex-1"></div>

    {#if !bookmarked}
      <button
        onclick={toggleBookmark}
        class="touch-target flex items-center gap-1 cursor-pointer"
        style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); background: var(--hairline); border: 0.5px solid var(--hairline-strong); padding: 4px 8px; border-radius: 6px;"
      >
        <NocturneIcon name="check" size={11} color="var(--text-faint)" />
        <span>Save</span>
      </button>
    {:else}
      <button
        onclick={toggleBookmark}
        class="touch-target flex items-center gap-1 cursor-pointer"
        style="font-family: var(--font-mono); font-size: 11px; color: {NOCTURNE.amber[400]}; background: {NOCTURNE.amber[400]}18; border: 0.5px solid {NOCTURNE.amber[400]}40; padding: 4px 8px; border-radius: 6px;"
      >🔖 Saved</button>
    {/if}
  </div>
</div>

{#snippet actionChip(icon: string, label: string, onclick: () => void)}
  <button
    {onclick}
    class="touch-target flex items-center gap-1.5 cursor-pointer"
    style="
          font-family: var(--font-mono); font-size: 11px; letter-spacing: 0;
          color: var(--text-faint); background: var(--hairline);
          border: 0.5px solid var(--hairline-strong);
      padding: 4px 8px; border-radius: 6px;
      transition: background var(--duration-fast);
    "
  >
    <NocturneIcon name={icon} size={11} color="var(--text-faint)" />
    <span>{label}</span>
  </button>
{/snippet}

<style>
  .message-markdown :global(.chat-md-table-wrap) {
    max-width: 100%;
    overflow-x: auto;
    margin: 0.65rem 0;
    border: 0.5px solid var(--hairline-strong);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-card) 82%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .message-markdown :global(.chat-md-table-wrap:focus-visible) {
    outline: 2px solid color-mix(in srgb, var(--text) 40%, transparent);
    outline-offset: 2px;
  }

  .message-markdown :global(.chat-md-table-wrap table) {
    width: max-content;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.86rem;
    line-height: 1.35;
  }

  .message-markdown :global(.chat-md-table-wrap th),
  .message-markdown :global(.chat-md-table-wrap td) {
    min-width: 7rem;
    max-width: 18rem;
    padding: 0.45rem 0.6rem;
    border-right: 0.5px solid var(--hairline);
    border-bottom: 0.5px solid var(--hairline);
    color: var(--text);
    vertical-align: top;
    white-space: normal;
  }

  .message-markdown :global(.chat-md-table-wrap th) {
    position: sticky;
    top: 0;
    z-index: 1;
    background: color-mix(in srgb, var(--bg-card) 92%, var(--text) 8%);
    color: var(--text);
    font-weight: 700;
  }

  .message-markdown :global(.chat-md-table-wrap tr:last-child td) {
    border-bottom: 0;
  }

  .message-markdown :global(.chat-md-table-wrap th:last-child),
  .message-markdown :global(.chat-md-table-wrap td:last-child) {
    border-right: 0;
  }

  .message-markdown :global(.chat-md-table-wrap tbody tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--hairline) 55%, transparent);
  }

  @media (max-width: 640px) {
    .message-markdown :global(.chat-md-table-wrap) {
      margin-right: -0.25rem;
    }

    .message-markdown :global(.chat-md-table-wrap th),
    .message-markdown :global(.chat-md-table-wrap td) {
      min-width: 8.5rem;
      padding: 0.5rem 0.6rem;
      font-size: 0.82rem;
    }
  }
</style>
