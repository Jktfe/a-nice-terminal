<script lang="ts">
  import { useGridStore } from '$lib/stores/grid.svelte';
  import { onDestroy, tick } from 'svelte';
  import { agentColor, agentColorFromSession } from '$lib/nocturne';

  interface Session {
    id: string;
    name: string;
    type: 'terminal' | 'chat' | 'agent' | string;
    handle?: string | null;
    alias?: string | null;
    display_name?: string | null;
    cli_flag?: string | null;
    linked_chat_id?: string | null;
  }

  interface GridCellDef {
    id: string;
    sessionId: string | null;
  }

  interface Message {
    id: string;
    role: string;
    content: string;
    format: string;
    msg_type?: string;
    meta?: string | Record<string, unknown> | null;
    sender_id?: string | null;
    target?: string | null;
    created_at?: string;
  }

  interface TerminalRow {
    id: number;
    ts_ms: number;
    text: string;
  }

  interface RoomParticipant {
    id: string;
    name?: string | null;
    handle?: string | null;
    alias?: string | null;
    session_type?: string | null;
    session_status?: string | null;
    cli_flag?: string | null;
    role?: string | null;
  }

  type LoadContentOptions = {
    background?: boolean;
  };

  const GRID_CHAT_PREVIEW_LIMIT = 20;
  const GRID_POLL_INTERVAL_MS = 10_000;
  const GRID_PARTICIPANTS_REFRESH_MS = 30_000;
  const GRID_VISIBLE_AGENT_COUNT = 3;

  let { cell, allSessions, onSwap, needsInputMap = new Map(), idleAttentionSet = new Set() }: {
    cell: GridCellDef;
    allSessions: Session[];
    onSwap?: (cellId: string, sessionId: string) => void;
    needsInputMap?: Map<string, { eventClass: string; summary: string }>;
    idleAttentionSet?: Set<string>;
  } = $props();

  // Derive badge state for this cell's session
  const cellNeedsInput = $derived(
    cell.sessionId ? (needsInputMap.get(cell.sessionId) ?? null) : null
  );
  const cellIdleAttention = $derived(
    cell.sessionId ? idleAttentionSet.has(cell.sessionId) : false
  );

  const grid = useGridStore();

  const session = $derived(
    cell.sessionId ? allSessions.find(s => s.id === cell.sessionId) ?? null : null
  );

  // ── Picker state ────────────────────────────────────────────────
  let showPicker = $state(false);
  let pickerSearch = $state('');
  let pickerEl = $state<HTMLElement | null>(null);

  const filteredSessions = $derived(
    allSessions.filter(s =>
      s.name.toLowerCase().includes(pickerSearch.toLowerCase())
    )
  );

  function openPicker(e?: MouseEvent) {
    e?.stopPropagation();
    pickerSearch = '';
    showPicker = true;
  }

  function pick(sessionId: string) {
    grid.assignCell(cell.id, sessionId);
    onSwap?.(cell.id, sessionId);
    showPicker = false;
  }

  function clear() {
    grid.clearCell(cell.id);
  }

  function onWindowClick(e: MouseEvent) {
    if (pickerEl && !pickerEl.contains(e.target as Node)) {
      showPicker = false;
    }
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') showPicker = false;
  }

  // ── View toggle (terminal sessions can flip to chat view) ────────
  let showChat = $state(false);

  // ── Content preview data ─────────────────────────────────────────
  let chatMessages = $state<Message[]>([]);
  let terminalLines = $state<TerminalRow[]>([]);
  let loadingContent = $state(false);
  let contentAtBottom = $state(true);
  let contentLoadSeq = 0;
  let chatMessagesFingerprint = '';
  let terminalLinesFingerprint = '';

  let linkedChatId = $state<string | null>(null);
  let chatInput = $state('');
  let chatInputEl = $state<HTMLTextAreaElement | null>(null);
  let sendingChat = $state(false);
  let sendError = $state('');
  let roomParticipants = $state<RoomParticipant[]>([]);
  let roomParticipantsRoomId = $state<string | null>(null);
  let participantsLoadSeq = 0;
  let participantPollTimer: ReturnType<typeof setInterval> | null = null;

  // ── @ mention autocomplete state ───────────────────────────────
  let mentionHandles = $state<{ handle: string; name: string }[]>([]);
  let mentionQuery = $state('');
  let showMentions = $state(false);
  let mentionStart = $state(-1);
  let mentionSelectedIdx = $state(0);

  const filteredHandles = $derived.by(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionHandles.slice(0, 6);
    return mentionHandles
      .filter((h) => h.handle.toLowerCase().includes(q) || h.name.toLowerCase().includes(q))
      .slice(0, 6);
  });

  const roomAgents = $derived(
    roomParticipants.filter((participant) => participant.session_type === 'terminal')
  );
  const visibleRoomAgents = $derived(roomAgents.slice(0, GRID_VISIBLE_AGENT_COUNT));
  const hiddenRoomAgentCount = $derived(Math.max(0, roomAgents.length - visibleRoomAgents.length));

  function isChatSessionType(type: string) {
    return type === 'chat' || type === 'agent';
  }

  function activeChatSessionId(): string | null {
    if (!session) return null;
    if (session.type === 'terminal') return showChat ? linkedChatId : null;
    if (isChatSessionType(session.type)) return session.id;
    return null;
  }

  function shouldShowComposer(): boolean {
    return !!activeChatSessionId();
  }

  function roomSessionId(): string | null {
    if (!session) return null;
    if (isChatSessionType(session.type)) return session.id;
    if (session.type === 'terminal') return linkedChatId;
    return null;
  }

  async function loadRoomParticipants(roomId: string) {
    const seq = ++participantsLoadSeq;
    try {
      const res = await fetch(`/api/sessions/${roomId}/participants`);
      if (!res.ok) return;
      const data = await res.json();
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const all = Array.isArray(data.all) ? data.all : [];
      if (seq === participantsLoadSeq && roomParticipantsRoomId === roomId) {
        roomParticipants = participants;
        const everyone = { handle: '@everyone', name: 'Everyone' };
        const fromAll = all
          .filter((p: any) => p && typeof p.handle === 'string' && p.handle)
          .map((p: any) => ({ handle: p.handle, name: p.name || p.handle }));
        const seen = new Set<string>([everyone.handle.toLowerCase()]);
        const merged: { handle: string; name: string }[] = [everyone];
        for (const h of fromAll) {
          const key = h.handle.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(h);
        }
        mentionHandles = merged;
      }
    } catch {
      // Advisory only — room preview should not fail because participant chips did.
    }
  }

  function participantLabel(participant: RoomParticipant): string {
    return (
      participant.alias ||
      participant.handle ||
      participant.name ||
      participant.id.slice(0, 8)
    ).replace(/^@/, '');
  }

  function participantTitle(participant: RoomParticipant): string {
    const status = participant.session_status ? ` — ${participant.session_status}` : '';
    const cli = participant.cli_flag ? ` (${participant.cli_flag})` : '';
    return `${participantLabel(participant)}${cli}${status}`;
  }

  function participantAccent(participant: RoomParticipant): string {
    const matched = allSessions.find((candidate) =>
      candidate.id === participant.id ||
      candidate.handle === participant.handle ||
      candidate.alias === participant.alias ||
      candidate.name === participant.name
    );
    if (matched) return agentColorFromSession(matched).color;
    return agentColor(participantLabel(participant)).color;
  }

  function participantInitial(participant: RoomParticipant): string {
    return participantLabel(participant).slice(0, 1).toUpperCase() || '?';
  }

  function roomAgentsTitle(): string {
    return roomAgents.length
      ? `Room agents: ${roomAgents.map(participantTitle).join(', ')}`
      : '';
  }

  function messageFingerprint(messages: Message[]): string {
    return messages
      .map((msg) => [
        msg.id,
        msg.created_at ?? '',
        msg.msg_type ?? '',
        msg.content.length,
        typeof msg.meta === 'string' ? msg.meta : JSON.stringify(msg.meta ?? null),
      ].join(':'))
      .join('|');
  }

  function terminalFingerprint(rows: TerminalRow[]): string {
    return rows.map((row) => `${row.id}:${row.ts_ms}:${row.text}`).join('|');
  }

  function setChatMessagesIfChanged(next: Message[]): boolean {
    const nextFingerprint = messageFingerprint(next);
    if (nextFingerprint === chatMessagesFingerprint) return false;
    chatMessages = next;
    chatMessagesFingerprint = nextFingerprint;
    return true;
  }

  function setTerminalLinesIfChanged(next: TerminalRow[]): boolean {
    const nextFingerprint = terminalFingerprint(next);
    if (nextFingerprint === terminalLinesFingerprint) return false;
    terminalLines = next;
    terminalLinesFingerprint = nextFingerprint;
    return true;
  }

  function resetContent() {
    chatMessages = [];
    terminalLines = [];
    chatMessagesFingerprint = '';
    terminalLinesFingerprint = '';
  }

  async function loadContent(
    sid: string,
    type: string,
    chatMode = showChat,
    currentLinkedChatId = linkedChatId,
    options: LoadContentOptions = {},
  ): Promise<boolean> {
    const seq = ++contentLoadSeq;
    const showLoading = !options.background;
    let changed = false;
    if (showLoading) loadingContent = true;
    try {
      if (isChatSessionType(type) || (type === 'terminal' && chatMode)) {
        // For terminal+showChat, load the linked chat's messages
        const chatSid = type === 'terminal' ? currentLinkedChatId : sid;
        if (!chatSid) {
          if (seq === contentLoadSeq) changed = setChatMessagesIfChanged([]);
          return changed;
        }
        const res = await fetch(`/api/sessions/${chatSid}/messages?limit=${GRID_CHAT_PREVIEW_LIMIT}`);
        if (res.ok) {
          const data = await res.json();
          if (seq === contentLoadSeq) changed = setChatMessagesIfChanged(data.messages ?? []);
        }
      }
      if (type === 'terminal' && !chatMode) {
        const res = await fetch(`/api/sessions/${sid}/terminal/history?since=5m&limit=10`);
        if (res.ok) {
          const data = await res.json();
          if (seq === contentLoadSeq) changed = setTerminalLinesIfChanged(data.rows ?? []);
        }
      }
    } catch {
      // Network error — leave empty
    } finally {
      if (seq === contentLoadSeq && (showLoading || loadingContent)) loadingContent = false;
    }
    return changed;
  }

  // Fetch linked_chat_id for terminal sessions
  async function fetchLinkedChatId(sid: string) {
    try {
      const res = await fetch(`/api/sessions/${sid}`);
      if (res.ok) {
        const data = await res.json();
        linkedChatId = data.linked_chat_id ?? null;
      }
    } catch {}
  }

  let contentScrollEl = $state<HTMLElement | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function scrollContentToBottom() {
    await tick();
    if (!contentScrollEl) return;
    contentScrollEl.scrollTop = contentScrollEl.scrollHeight;
    contentAtBottom = true;
  }

  function onContentScroll() {
    if (!contentScrollEl) return;
    const threshold = 36;
    contentAtBottom = contentScrollEl.scrollHeight - contentScrollEl.scrollTop - contentScrollEl.clientHeight < threshold;
  }

  // Fetch linked chat ID when session changes
  $effect(() => {
    if (session?.type === 'terminal') {
      linkedChatId = session.linked_chat_id ?? null;
      fetchLinkedChatId(session.id);
    } else {
      linkedChatId = null;
    }
  });

  $effect(() => {
    const roomId = roomSessionId();
    if (participantPollTimer) {
      clearInterval(participantPollTimer);
      participantPollTimer = null;
    }

    roomParticipantsRoomId = roomId;
    roomParticipants = [];
    if (!roomId) return;

    void loadRoomParticipants(roomId);
    participantPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadRoomParticipants(roomId);
    }, GRID_PARTICIPANTS_REFRESH_MS);
  });

  // Reload content when session or showChat changes
  $effect(() => {
    if (session) {
      const chatMode = showChat;
      const currentLinkedChatId = linkedChatId;
      resetContent();
      contentAtBottom = true;
      sendError = '';
      loadContent(session.id, session.type, chatMode, currentLinkedChatId).then(() => {
        if (isChatSessionType(session.type) || (session.type === 'terminal' && chatMode)) {
          scrollContentToBottom();
        }
      });

      // Poll every 5s for fresh content
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!session) return;
        const prevLen = chatMessages.length + terminalLines.length;
        const wasAtBottom = contentAtBottom;
        const pollChatMode = showChat;
        const pollLinkedChatId = linkedChatId;
        const changed = await loadContent(session.id, session.type, pollChatMode, pollLinkedChatId, { background: true });
        const newLen = chatMessages.length + terminalLines.length;
        if (changed && newLen > prevLen && wasAtBottom) void scrollContentToBottom();
      }, GRID_POLL_INTERVAL_MS);
    } else {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (participantPollTimer) clearInterval(participantPollTimer);
  });

  // ── Agent event card helpers ──────────────────────────────────────
  function parseEvent(content: string) {
    try { return JSON.parse(content); }
    catch { return { class: 'unknown', payload: {}, text: content }; }
  }

  function parseMeta(meta: Message['meta']) {
    if (meta && typeof meta === 'object') return meta;
    try { return meta ? JSON.parse(meta) : {}; }
    catch { return {}; }
  }

  async function respondToEvent(msg: Message, type: string, choice: Record<string, any>) {
    if (!session) return;
    const targetSessionId = activeChatSessionId() || session.id;
    const responsePayload = {
      type,
      event_id: msg.id,
      event_content: msg.content,
      choice,
      ...(session.type === 'terminal' ? { terminal_session_id: session.id } : {}),
    };
    await fetch(`/api/sessions/${targetSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: JSON.stringify(responsePayload),
        format: 'json',
        msg_type: 'agent_response',
      }),
    });
    // Reload messages to reflect new state
    await loadContent(session.id, session.type, showChat, linkedChatId, { background: true });
  }

  function resizeChatInput() {
    if (!chatInputEl) return;
    chatInputEl.style.height = 'auto';
    const nextHeight = Math.min(chatInputEl.scrollHeight, 84);
    chatInputEl.style.height = `${nextHeight}px`;
    chatInputEl.style.overflowY = chatInputEl.scrollHeight > 84 ? 'auto' : 'hidden';
  }

  $effect(() => {
    chatInput;
    queueMicrotask(resizeChatInput);
  });

  async function writeTerminalInput(terminalId: string, text: string) {
    const first = await fetch(`/api/sessions/${terminalId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: text }),
    });
    if (!first.ok) throw new Error('terminal input failed');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const enter = await fetch(`/api/sessions/${terminalId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '\r' }),
    });
    if (!enter.ok) throw new Error('terminal enter failed');
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    const targetChatId = activeChatSessionId();
    if (!text || !session || !targetChatId || sendingChat) return;

    sendingChat = true;
    sendError = '';
    chatInput = '';

    try {
      if (session.type === 'terminal' && showChat) {
        await writeTerminalInput(session.id, text);
      }

      const res = await fetch(`/api/sessions/${targetChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: text,
          format: 'text',
          sender_id: null,
          msg_type: 'message',
          meta: { source: session.type === 'terminal' ? 'grid_terminal_chat' : 'grid_chat' },
        }),
      });
      if (!res.ok) throw new Error('message post failed');
      const msg = await res.json();
      if (msg?.id && !chatMessages.find(m => m.id === msg.id)) {
        chatMessages = [...chatMessages, msg];
      }
      await loadContent(session.id, session.type, showChat, linkedChatId, { background: true });
      sendingChat = false;
      await scrollContentToBottom();
      chatInputEl?.focus();
    } catch {
      chatInput = text;
      sendError = 'Could not send';
      queueMicrotask(resizeChatInput);
    } finally {
      sendingChat = false;
    }
  }

  function detectMentionTrigger() {
    if (!chatInputEl) return;
    const cursor = chatInputEl.selectionStart ?? chatInput.length;
    const before = chatInput.slice(0, cursor);
    const m = before.match(/@([\w.-]*)$/);
    if (m && mentionHandles.length > 0) {
      mentionStart = cursor - m[0].length;
      mentionQuery = m[1];
      mentionSelectedIdx = 0;
      showMentions = true;
    } else {
      showMentions = false;
      mentionStart = -1;
    }
  }

  function selectMention(handle: string) {
    if (!chatInputEl || mentionStart < 0) return;
    const cursor = chatInputEl.selectionStart ?? chatInput.length;
    const before = chatInput.slice(0, mentionStart);
    const after = chatInput.slice(cursor);
    chatInput = `${before}${handle} ${after}`;
    showMentions = false;
    mentionStart = -1;
    queueMicrotask(() => {
      chatInputEl?.focus();
      const pos = before.length + handle.length + 1;
      chatInputEl?.setSelectionRange(pos, pos);
    });
  }

  function onChatInput() {
    sendError = '';
    resizeChatInput();
    detectMentionTrigger();
  }

  function handleChatInputKeydown(e: KeyboardEvent) {
    if (showMentions && filteredHandles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIdx = Math.min(mentionSelectedIdx + 1, filteredHandles.length - 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIdx = Math.max(mentionSelectedIdx - 1, 0);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectMention(filteredHandles[mentionSelectedIdx].handle);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        showMentions = false;
        mentionStart = -1;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  }

  function resolveSenderSession(senderId: string | null | undefined): Session | null {
    if (!senderId) return null;
    return allSessions.find(s =>
      s.id === senderId ||
      s.handle === senderId ||
      s.alias === senderId ||
      (s.handle && senderId === s.handle.replace(/^@/, ''))
    ) ?? null;
  }

  function senderLabel(msg: Message): string {
    const sender = resolveSenderSession(msg.sender_id);
    if (sender) return sender.display_name || sender.handle || sender.name || sender.id.slice(0, 8);
    if (msg.sender_id) return msg.sender_id.startsWith('@') ? msg.sender_id : `Session ${msg.sender_id.slice(0, 8)}`;
    if (msg.role === 'user' || msg.role === 'human') return 'You';
    return 'Assistant';
  }

  function senderDetail(msg: Message): string {
    const sender = resolveSenderSession(msg.sender_id);
    if (sender?.handle && sender.handle !== senderLabel(msg)) return sender.handle;
    if (msg.target && msg.target !== '@everyone') return `to ${msg.target}`;
    if (msg.role === 'assistant') return 'assistant';
    if (msg.role === 'user' || msg.role === 'human') return 'posted from dashboard';
    return msg.role || 'message';
  }

  function senderAccent(msg: Message): string {
    const sender = resolveSenderSession(msg.sender_id);
    if (sender) return agentColorFromSession(sender).color;
    if (msg.sender_id) return agentColor(msg.sender_id).color;
    if (msg.role === 'user' || msg.role === 'human') return '#374151';
    return '#10B981';
  }

  function messageTone(msg: Message): { background: string; border: string; color: string } {
    const accent = senderAccent(msg);
    if (msg.role === 'user' || msg.role === 'human') {
      return { background: '#F8FAFC', border: '#CBD5E1', color: '#1F2937' };
    }
    return { background: `${accent}10`, border: `${accent}45`, color: '#111827' };
  }

  function senderInitial(msg: Message): string {
    return senderLabel(msg).replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
  }

  function formatTime(value: string | undefined): string {
    if (!value) return '';
    const iso = value.includes('Z') || value.includes('+') ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Icon helpers ──────────────────────────────────────────────────
  function sessionIconName(type: string) {
    return type === 'terminal' ? 'terminal' : 'message-square';
  }

  function sessionIconColor(type: string) {
    return type === 'terminal' ? '#4F46E5' : '#6366F1';
  }
</script>

<svelte:window onclick={onWindowClick} />

<div
  class="relative flex flex-col rounded-[10px] overflow-hidden"
  style="
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    height: 100%;
  "
>
  {#if cell.sessionId === null}
    <!-- ── Empty slot ── -->
    <button
      onclick={(e) => openPicker(e)}
      class="flex-1 flex flex-col items-center justify-center gap-2 transition-colors"
      style="
        background: transparent;
        border: 1.5px dashed #E5E7EB;
        border-radius: 10px;
        cursor: pointer;
        margin: 0;
      "
      onmouseover={(e) => (e.currentTarget.style.background = '#F9FAFB')}
      onmouseout={(e) => (e.currentTarget.style.background = 'transparent')}
      onfocus={(e) => (e.currentTarget.style.background = '#F9FAFB')}
      onblur={(e) => (e.currentTarget.style.background = 'transparent')}
      title="Select session"
    >
      <!-- Plus icon (lucide style) -->
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span style="font-family: Inter, sans-serif; font-size: 13px; color: #9CA3AF;">Select session</span>
    </button>

  {:else if session === null}
    <!-- ── Session deleted / not found ── -->
    <div class="flex-1 flex flex-col items-center justify-center gap-2 p-3">
      <p style="font-size: 12px; color: #9CA3AF; font-family: Inter, sans-serif;">Session not found</p>
      <button
        onclick={clear}
        style="font-size: 12px; color: #6B7280; background: #F3F4F6; border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer;"
      >Clear</button>
    </div>

  {:else}
    <!-- ── Filled slot ── -->

    <!-- Slot header -->
    <div
      class="flex items-center gap-2 flex-shrink-0"
      style="
        height: 38px;
        padding: 0 12px;
        background: #F9FAFB;
        border-bottom: 1px solid #E5E7EB;
      "
    >
      <!-- Session type icon -->
      {#if session.type === 'terminal'}
        <!-- Terminal icon -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sessionIconColor(session.type)} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      {:else}
        <!-- Message-square icon -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sessionIconColor(session.type)} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      {/if}

      <!-- Session name -->
      <span
        class="flex-1 truncate"
        style="font-family: Inter, sans-serif; font-size: 12px; font-weight: 600; color: #111827;"
      >{session.name}</span>

      {#if visibleRoomAgents.length > 0}
        <div class="grid-room-agents" title={roomAgentsTitle()} aria-label={roomAgentsTitle()}>
          {#each visibleRoomAgents as participant (participant.id)}
            {@const accent = participantAccent(participant)}
            <span
              class="grid-room-agent"
              style="--agent-accent: {accent};"
              title={participantTitle(participant)}
            >
              <span class="grid-room-agent__avatar">{participantInitial(participant)}</span>
              <span class="grid-room-agent__name">{participantLabel(participant)}</span>
            </span>
          {/each}
          {#if hiddenRoomAgentCount > 0}
            <span class="grid-room-agent grid-room-agent--more" title={roomAgentsTitle()}>
              +{hiddenRoomAgentCount}
            </span>
          {/if}
        </div>
      {/if}

      <!-- Trailing: badge + action buttons (right-aligned, never shrink) -->
      <div style="margin-left: auto; display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
        {#if cellNeedsInput}
          <span
            class="grid-pulse-dot"
            title={cellNeedsInput.summary}
          ></span>
        {:else if cellIdleAttention}
          <span
            class="grid-idle-dot"
            title="Terminal idle"
          ></span>
        {/if}

        <!-- Toggle icon: only for terminal sessions — flips to chat view -->
        {#if session.type === 'terminal'}
          <button
            onclick={() => (showChat = !showChat)}
            title={showChat ? 'View terminal output' : 'View linked chat'}
            style="background: none; border: none; padding: 2px; cursor: pointer; color: {showChat ? '#6366F1' : '#9CA3AF'}; line-height: 0; border-radius: 4px;"
          >
            {#if showChat}
              <!-- terminal icon (switch back) -->
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            {:else}
              <!-- message-square icon -->
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            {/if}
          </button>
        {/if}

        <a
          href={`/session/${session.id}`}
          title="Open full session"
          aria-label={`Open ${session.name} full session`}
          class="grid-slot-action"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
        </a>

        <!-- svelte-ignore a11y_mouse_events_have_key_events -->
        <!-- Swap / replace icon -->
        <button
          onclick={(e) => openPicker(e)}
          title="Replace session"
          style="background: none; border: none; padding: 2px; cursor: pointer; color: #9CA3AF; line-height: 0; border-radius: 4px;"
          onmouseover={(e) => (e.currentTarget.style.color = '#6B7280')}
          onmouseout={(e) => (e.currentTarget.style.color = '#9CA3AF')}
        >
          <!-- replace / swap icon -->
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 3l4 4-4 4" />
            <path d="M9 7H3" />
            <path d="M19 21l-4-4 4-4" />
            <path d="M15 17h6" />
            <line x1="21" y1="7" x2="3" y2="7" />
            <line x1="3" y1="17" x2="21" y2="17" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Slot body: content preview -->
    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">

      {#if session.type === 'terminal' && !showChat}
        <!-- ── Terminal preview ── -->
        <div
          class="h-full overflow-y-auto"
          style="background: #0D1117; padding: 12px;"
          bind:this={contentScrollEl}
          onscroll={onContentScroll}
        >
          {#if loadingContent}
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8B949E;">Loading…</span>
          {:else if terminalLines.length === 0}
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8B949E;">No recent output</span>
          {:else}
            {#each terminalLines as row (row.id)}
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.6; color: {row.text.startsWith('✶') || row.text.startsWith('✽') ? '#C9D1D9' : '#8B949E'}; white-space: pre-wrap; word-break: break-all;">
                {row.text}
              </div>
            {/each}
          {/if}
        </div>

      {:else}
        <!-- ── Chat preview ── -->
        <div
          class="flex-1 min-h-0 overflow-y-auto"
          style="padding: 10px 10px 8px; background: linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%);"
          bind:this={contentScrollEl}
          onscroll={onContentScroll}
        >
          <div class="grid-chat-stack">
            {#if loadingContent}
              <span class="grid-chat-empty">Loading...</span>
            {:else if session.type === 'terminal' && showChat && !linkedChatId}
              <span class="grid-chat-empty">No linked chat for this terminal</span>
            {:else if chatMessages.length === 0}
              <span class="grid-chat-empty">No messages yet</span>
            {:else}
              {#each chatMessages as msg (msg.id)}
                {#if msg.msg_type === 'agent_event'}
                  <!-- ── Mini AgentEventCard ── -->
                  {@const ev = parseEvent(msg.content)}
                  {@const mt = parseMeta(msg.meta)}
                  {@const responded = mt.status === 'responded' || mt.status === 'settled'}
                  <div class="grid-event-card">
                    <div class="grid-event-card__label">
                      {ev.class?.replace(/_/g, ' ') ?? 'event'}
                    </div>
                    {#if ev.class === 'permission_request'}
                      <div class="grid-event-card__body">
                        {ev.payload?.command ?? ev.payload?.file ?? ev.text ?? ''}
                      </div>
                      {#if responded}
                        <div class="grid-event-card__resolved" style="color: {mt.chosen === 'approve' ? '#16A34A' : '#DC2626'};">
                          {mt.chosen === 'approve' ? 'Approved' : 'Denied'}
                        </div>
                      {:else}
                        <div class="flex gap-1.5">
                          <button
                            onclick={() => respondToEvent(msg, 'approve', { action: 'approve' })}
                            class="grid-event-card__button grid-event-card__button--approve"
                          >Approve</button>
                          <button
                            onclick={() => respondToEvent(msg, 'deny', { action: 'deny' })}
                            class="grid-event-card__button grid-event-card__button--deny"
                          >Deny</button>
                        </div>
                      {/if}
                    {:else}
                      <div class="grid-event-card__body">
                        {ev.payload?.message ?? ev.text ?? ev.payload?.question ?? ''}
                      </div>
                    {/if}
                  </div>

                {:else}
                  <!-- ── Regular message bubble ── -->
                  {@const tone = messageTone(msg)}
                  {@const accent = senderAccent(msg)}
                  <div
                    class="grid-message"
                    style="
                      --accent: {accent};
                      background: {tone.background};
                      border-color: {tone.border};
                      color: {tone.color};
                    "
                  >
                    <div class="grid-message__header">
                      <span class="grid-message__avatar" style="background: {accent};">{senderInitial(msg)}</span>
                      <span class="grid-message__name" style="color: {accent};">{senderLabel(msg)}</span>
                      <span class="grid-message__detail">{senderDetail(msg)}</span>
                      {#if formatTime(msg.created_at)}
                        <span class="grid-message__time">{formatTime(msg.created_at)}</span>
                      {/if}
                    </div>
                    <div class="grid-message__content">
                      {msg.content.slice(0, 500)}{msg.content.length > 500 ? '...' : ''}
                    </div>
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        </div>

        {#if shouldShowComposer()}
          <div class="grid-chat-composer">
            {#if sendError}
              <div class="grid-chat-error">{sendError}</div>
            {/if}
            {#if showMentions && filteredHandles.length > 0}
              <div class="grid-mention-popover" role="listbox" aria-label="Mention suggestions">
                {#each filteredHandles as h, i (h.handle)}
                  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                  <button
                    type="button"
                    class="grid-mention-item"
                    class:grid-mention-item--active={i === mentionSelectedIdx}
                    onmousedown={(e) => { e.preventDefault(); selectMention(h.handle); }}
                    onmouseover={() => (mentionSelectedIdx = i)}
                  >
                    <span class="grid-mention-handle">{h.handle}</span>
                    {#if h.name && h.name !== h.handle}
                      <span class="grid-mention-name">{h.name}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
            <div class="grid-chat-input-row">
              <textarea
                bind:this={chatInputEl}
                bind:value={chatInput}
                oninput={onChatInput}
                onkeydown={handleChatInputKeydown}
                onblur={() => queueMicrotask(() => (showMentions = false))}
                disabled={sendingChat}
                rows="1"
                placeholder={session.type === 'terminal' ? 'Send to linked terminal chat...' : 'Message this chat...'}
                class="grid-chat-input"
              ></textarea>
              <button
                onclick={sendChatMessage}
                disabled={!chatInput.trim() || sendingChat}
                class="grid-chat-send"
                title="Send message"
                aria-label="Send message"
              >
                {#if sendingChat}
                  <svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-dasharray="28" stroke-dashoffset="8" />
                  </svg>
                {:else}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- ── Session picker overlay ── -->
  {#if showPicker}
    <div
      bind:this={pickerEl}
      role="listbox"
      tabindex="-1"
      onkeydown={onPickerKeydown}
      class="absolute inset-0 z-20 flex flex-col overflow-hidden"
      style="background: #FFFFFF; border-radius: 10px; border: 1px solid #E5E7EB; box-shadow: 0 8px 24px rgba(0,0,0,0.12);"
    >
      <div style="padding: 10px 12px; border-bottom: 1px solid #E5E7EB;">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          placeholder="Search sessions…"
          bind:value={pickerSearch}
          autofocus
          class="w-full focus:outline-none"
          style="
            background: #F9FAFB;
            border: 1px solid #E5E7EB;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #111827;
            font-family: Inter, sans-serif;
          "
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if filteredSessions.length === 0}
          <p style="font-size: 12px; color: #9CA3AF; text-align: center; padding: 16px; font-family: Inter, sans-serif;">
            No sessions found
          </p>
        {:else}
          {#each filteredSessions as s (s.id)}
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <button
              onclick={() => pick(s.id)}
              class="w-full text-left flex items-center gap-2 transition-colors"
              style="padding: 8px 12px; background: transparent; border: none; cursor: pointer; font-family: Inter, sans-serif; border-bottom: 1px solid #F3F4F6;"
              onmouseover={(e) => (e.currentTarget.style.background = '#F9FAFB')}
              onmouseout={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {#if s.type === 'terminal'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              {/if}
              <span style="font-size: 12px; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{s.name}</span>
              <span style="font-size: 10px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.04em;">{s.type}</span>
            </button>
          {/each}
        {/if}
      </div>
      <div style="padding: 8px 12px; border-top: 1px solid #E5E7EB;">
        <button
          onclick={() => (showPicker = false)}
          class="w-full"
          style="padding: 6px; border-radius: 6px; background: #F3F4F6; border: none; font-size: 12px; color: #6B7280; cursor: pointer; font-family: Inter, sans-serif;"
        >Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .grid-chat-stack {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 8px;
  }

  .grid-chat-empty {
    align-self: center;
    margin: auto 0;
    font-family: Inter, sans-serif;
    font-size: 10.5px;
    color: #94A3B8;
  }

  .grid-room-agents {
    min-width: 0;
    max-width: min(46%, 230px);
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    flex-shrink: 1;
  }

  .grid-room-agent {
    min-width: 0;
    max-width: 74px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px 2px 3px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--agent-accent) 35%, #E5E7EB);
    background: color-mix(in srgb, var(--agent-accent) 10%, #FFFFFF);
    color: #111827;
    font-family: Inter, sans-serif;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 1;
  }

  .grid-room-agent__avatar {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--agent-accent);
    color: #FFFFFF;
    font-size: 7.5px;
    font-weight: 850;
  }

  .grid-room-agent__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grid-room-agent--more {
    max-width: none;
    padding: 2px 6px;
    border-color: #D1D5DB;
    background: #F3F4F6;
    color: #6B7280;
    flex-shrink: 0;
  }

  .grid-slot-action {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 2px;
    border-radius: 4px;
    color: #9CA3AF;
    line-height: 0;
    text-decoration: none;
    transition: color 120ms ease, background 120ms ease;
  }

  .grid-slot-action:hover,
  .grid-slot-action:focus-visible {
    color: #4F46E5;
    background: #EEF2FF;
    outline: none;
  }

  .grid-message {
    border: 1px solid;
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 7px 9px 8px;
    font-family: Inter, sans-serif;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  .grid-message__header {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin-bottom: 4px;
  }

  .grid-message__avatar {
    width: 16px;
    height: 16px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: white;
    font-size: 8px;
    font-weight: 800;
    line-height: 1;
  }

  .grid-message__name {
    min-width: 0;
    max-width: 46%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10.5px;
    font-weight: 750;
  }

  .grid-message__detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #94A3B8;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .grid-message__time {
    margin-left: auto;
    flex-shrink: 0;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: #94A3B8;
    font-size: 9px;
    letter-spacing: 0;
  }

  .grid-message__content {
    color: #1F2937;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 112px;
    overflow: hidden;
  }

  .grid-event-card {
    border-radius: 8px;
    background: #EEF2FF;
    border: 1px solid #6366F180;
    padding: 8px 10px;
    font-family: Inter, sans-serif;
  }

  .grid-event-card__label {
    font-size: 8px;
    font-weight: 800;
    color: #4F46E5;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .grid-event-card__body {
    font-size: 10px;
    color: #374151;
    line-height: 1.45;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }

  .grid-event-card__resolved {
    font-size: 10px;
    font-weight: 700;
  }

  .grid-event-card__button {
    padding: 4px 9px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .grid-event-card__button--approve {
    background: #16A34A;
    color: #FFFFFF;
    border: 1px solid #16A34A;
  }

  .grid-event-card__button--deny {
    background: #FFFFFF;
    color: #DC2626;
    border: 1px solid #FCA5A5;
  }

  .grid-chat-composer {
    flex-shrink: 0;
    padding: 8px 10px 10px;
    border-top: 1px solid #E5E7EB;
    background: #FFFFFF;
    position: relative;
  }

  .grid-mention-popover {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 10px;
    right: 10px;
    max-height: 180px;
    overflow-y: auto;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.10);
    z-index: 30;
    padding: 4px;
  }

  .grid-mention-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    font-family: Inter, sans-serif;
    font-size: 12px;
    color: #111827;
  }

  .grid-mention-item--active {
    background: #EEF2FF;
  }

  .grid-mention-handle {
    font-weight: 600;
    color: #4F46E5;
  }

  .grid-mention-name {
    color: #6B7280;
    font-size: 11px;
  }

  .grid-chat-error {
    margin-bottom: 5px;
    font-family: Inter, sans-serif;
    font-size: 10px;
    color: #DC2626;
  }

  .grid-chat-input-row {
    display: flex;
    align-items: flex-end;
    gap: 7px;
    min-height: 38px;
    padding: 6px;
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    background: #F8FAFC;
    transition: border-color 120ms ease, background 120ms ease;
  }

  .grid-chat-input-row:focus-within {
    border-color: #6366F1;
    background: #FFFFFF;
  }

  .grid-chat-input {
    flex: 1;
    min-width: 0;
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: #111827;
    font-family: Inter, sans-serif;
    font-size: 11.5px;
    line-height: 1.35;
    max-height: 84px;
    padding: 3px 1px;
  }

  .grid-chat-input::placeholder {
    color: #94A3B8;
  }

  .grid-chat-send {
    width: 28px;
    height: 28px;
    border: 1px solid #4F46E5;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #FFFFFF;
    background: #4F46E5;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
  }

  .grid-chat-send:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .grid-chat-send:not(:disabled):active {
    transform: translateY(1px);
  }

  .grid-pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #EF4444;
    display: inline-block;
    flex-shrink: 0;
    animation: ant-grid-pulse 1.5s ease-in-out infinite;
  }
  .grid-idle-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #F59E0B;
    display: inline-block;
    flex-shrink: 0;
    opacity: 0.5;
  }
  @keyframes ant-grid-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.5); }
  }
</style>
