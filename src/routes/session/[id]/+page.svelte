<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useMessageStore } from '$lib/stores/messages.svelte';
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import CLIInput from '$lib/components/CLIInput.svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import ChatHeader from '$lib/components/ChatHeader.svelte';
  import ChatMessages from '$lib/components/ChatMessages.svelte';
  import ChatSidePanel from '$lib/components/ChatSidePanel.svelte';
  import DigestPanel from '$lib/components/DigestPanel.svelte';
  import ActivityRail from '$lib/components/ActivityRail.svelte';
  import RunView from '$lib/components/RunView.svelte';
  import FolderDrawer from '$lib/components/FolderDrawer.svelte';
  import ExportSheet from '$lib/components/ExportSheet.svelte';
  import { useToasts } from '$lib/stores/toast.svelte';
  import { normalizeSessionName } from '$lib/utils/session-naming';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';
  import { interviewMentions } from '$lib/utils/mentions';
  import { onMount, onDestroy } from 'svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    alias?: string | null;
    display_name?: string;
    linked_chat_id?: string | null;
    ttl?: string;
    cli_flag?: string | null;
    root_dir?: string | null;
    attention_state?: string | null;
    attention_reason?: string | null;
    attention_set_by?: string | null;
    attention_expires_at?: number | null;
    focus_queue_count?: number | null;
  }

  interface MessageSearchResult {
    id: string;
    session_id: string;
    role: string;
    content: string;
    created_at: string;
    sender_id?: string | null;
    target?: string | null;
    msg_type?: string;
    snippet?: string;
  }

  interface RunEvent {
    id: string;
    session_id: string;
    ts: number;
    source: 'acp' | 'hook' | 'json' | 'rpc' | 'terminal' | 'status' | 'tmux';
    trust: 'high' | 'medium' | 'raw';
    kind: string;
    text: string;
    payload?: Record<string, unknown>;
    // RunView expects string | undefined; the API can return null, so we
    // normalise on ingest (see refreshRunEvents/appendRunEvent below).
    raw_ref?: string;
  }

  interface WorkspaceOption {
    id: string;
    name: string;
    root_dir?: string | null;
  }

  interface UploadRecord {
    id: string;
    original_name: string;
    mime_type: string;
    content_hash: string;
    size_bytes: number;
    public_url: string;
    created_at?: string;
  }

  const toasts = useToasts();

  const sessionId = $derived($page.params.id as string);
  const msgStore = useMessageStore();
  const sessionStore = useSessionStore();

  let session = $state<PageSession | null>(null);
  let allSessions = $state<PageSession[]>([]);
  const shortcutScope = $derived.by(() => {
    if (session?.type === 'terminal') return 'linkedChats';
    if (session?.type === 'chat') {
      const linkedChat = allSessions.some((candidate) =>
        candidate.type === 'terminal' && candidate.linked_chat_id === session?.id
      );
      return linkedChat || isAutoLinkedChatSession(session) ? 'linkedChats' : 'chatrooms';
    }
    return 'all';
  });
  let mode = $state('chat');
  let showMenu = $state(false);
  // Panel closed by default on thin/mobile browsers (<1024px), open on desktop
  let showPanel = $state(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  let panelTab = $state('participants');
  let panelSwipeStart = $state<{ x: number; y: number; intent: 'open' | 'close' } | null>(null);
  let backSwipeStart = $state<{ x: number; y: number } | null>(null);

  const effectiveShowPanel = $derived(showPanel);

  function beginPanelSwipe(e: TouchEvent, intent: 'open' | 'close') {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    const touch = e.touches[0];
    if (!touch) return;
    panelSwipeStart = { x: touch.clientX, y: touch.clientY, intent };
  }

  function movePanelSwipe(e: TouchEvent) {
    const start = panelSwipeStart;
    const touch = e.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) > 64) {
      panelSwipeStart = null;
      return;
    }
    if (start.intent === 'open' && dx < -36) {
      showPanel = true;
      panelSwipeStart = null;
    } else if (start.intent === 'close' && dx > 36) {
      showPanel = false;
      panelSwipeStart = null;
    }
  }

  // P0 — left-edge back-nav gutter. xterm canvas captures all touch events,
  // so a horizontal swipe from a focused terminal would never reach a parent
  // listener. The gutter is "explicit chrome" per @antcodex's scroll-stealing
  // rule: a fixed 8px strip on the left edge that intercepts touches before
  // xterm sees them. Right-swipe with dx > 60 + |dy| < 64 navigates back.
  function beginBackSwipe(e: TouchEvent) {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    const touch = e.touches[0];
    if (!touch) return;
    backSwipeStart = { x: touch.clientX, y: touch.clientY };
  }

  function moveBackSwipe(e: TouchEvent) {
    const start = backSwipeStart;
    const touch = e.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) > 64) {
      backSwipeStart = null;
      return;
    }
    if (dx > 60) {
      backSwipeStart = null;
      if (typeof window !== 'undefined' && window.history.length > 1) {
        window.history.back();
      } else {
        goto('/');
      }
    }
  }

  function endBackSwipe() {
    backSwipeStart = null;
  }

  let tasks = $state<{ id: string; status: string; [key: string]: unknown }[]>([]);
  let fileRefs = $state<{ id: string; file_path?: string; [key: string]: unknown }[]>([]);
  let uploads = $state<UploadRecord[]>([]);
  let workspaces = $state<WorkspaceOption[]>([]);
  let replyTo = $state<Record<string, unknown> | null>(null);
  let showDigest = $state(false);

  // ANT Terminal view — normalized append-only run events
  let runEvents = $state<RunEvent[]>([]);
  let runEventsLoaded = $state(false);
  let runSearchQuery = $state('');
  let runShowStatusEvents = $state(false);
  let runShowProgressEvents = $state(true);
  let runEventsLoading = $state(false);

  let terminalSpawnTimer: ReturnType<typeof setTimeout> | null = null;

  function normaliseRunEvent(e: RunEvent & { raw_ref?: string | null }): RunEvent {
    return { ...e, raw_ref: e.raw_ref ?? undefined };
  }

  async function refreshRunEvents(force = false) {
    if (!sessionId || session?.type !== 'terminal') return;
    if (runEventsLoaded && !force) return;
    runEventsLoading = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/run-events?since=6h&limit=500`);
      if (res.ok) {
        const data = await res.json();
        runEvents = (data.events || []).map(normaliseRunEvent);
        runEventsLoaded = true;
      }
    } catch {
    } finally {
      runEventsLoading = false;
    }
  }

  function appendRunEvent(event: RunEvent) {
    if (!event?.id || runEvents.some(e => e.id === event.id)) return;
    runEvents = [...runEvents, normaliseRunEvent(event)].slice(-1000);
  }

  // Auto-scroll
  let chatScrollEl = $state<HTMLElement | null>(null);
  let atBottom = $state(true);

  function scrollToBottom() {
    if (chatScrollEl) { chatScrollEl.scrollTop = chatScrollEl.scrollHeight; atBottom = true; }
  }

  function onChatScroll() {
    if (!chatScrollEl) return;
    const threshold = 80;
    atBottom = chatScrollEl.scrollHeight - chatScrollEl.scrollTop - chatScrollEl.clientHeight < threshold;
    if (linkedChatId && chatScrollEl.scrollTop < 100 && linkedChatHasMore && !linkedChatLoadingMore) {
      linkedChatScrollEl = chatScrollEl;
      loadOlderLinkedChatMessages();
    }
  }

  $effect(() => {
    if (msgStore.messages.length && atBottom) {
      setTimeout(scrollToBottom, 30);
    }
  });

  // Mark messages as read when new messages arrive or we're at the bottom
  $effect(() => {
    if (displayMessages.length && atBottom) {
      markVisibleMessagesAsRead();
    }
  });

  let termKey = $state(0);
  let cmdPoll: ReturnType<typeof setInterval> | null = null;

  // Memory panel state
  let memories = $state<Record<string, unknown>[]>([]);
  let memorySearch = $state('');
  let memorySearchResults = $state<Record<string, unknown>[]>([]);
  let memorySearching = $state(false);

  async function loadMemories() {
    const res = await fetch('/api/memories?limit=50');
    const data = await res.json();
    memories = data.memories || [];
  }

  async function loadUploads(targetSessionId = sessionId) {
    try {
      const res = await fetch(`/api/sessions/${targetSessionId}/attachments`);
      if (!res.ok) return;
      const data = await res.json();
      uploads = data.uploads || [];
    } catch {}
  }

  async function addMemory(key: string, value: string) {
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, session_id: sessionId, created_by: session?.handle || sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      memories = [data.memory, ...memories];
      toasts.show('Memory saved');
    }
  }

  async function deleteMemory(id: unknown) {
    await fetch(`/api/memories?id=${id}`, { method: 'DELETE' });
    memories = memories.filter(m => m.id !== id);
    memorySearchResults = memorySearchResults.filter(m => m.id !== id);
  }

  let _memSearchTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = memorySearch;
    if (_memSearchTimer) clearTimeout(_memSearchTimer);
    if (!q.trim()) { memorySearchResults = []; return; }
    memorySearching = true;
    _memSearchTimer = setTimeout(async () => {
      const res = await fetch(`/api/memories?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      memorySearchResults = data.memories || [];
      memorySearching = false;
    }, 300);
  });

  // @ mention handles
  let mentionHandles = $state<{ handle: string; name: string }[]>([]);
  let roomParticipants = $state<Record<string, unknown>[]>([]);
  let postsFrom = $state<Record<string, unknown>[]>([]);

  async function loadMentionHandles(
    sourceSessionId = session?.type === 'terminal' && linkedChatId ? linkedChatId : sessionId,
    pageSessionId = sessionId,
  ) {
    try {
      const res = await fetch(`/api/sessions/${sourceSessionId}/participants`);
      const data = await res.json();
      if (pageSessionId !== sessionId) return;
      mentionHandles = (data.all || [])
        .filter((p: Record<string, string>) => p.handle)
        .map((p: Record<string, string>) => ({ handle: p.handle, name: p.name || p.handle }));
      roomParticipants = data.participants || [];
      postsFrom = data.postsFrom || [];
    } catch {}
  }

  // Parent context for discussion rooms
  let parentContext = $state<{ roomName: string; messages: Record<string, unknown>[] } | null>(null);

  async function loadParentContext() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/links`);
      if (!res.ok) return;
      const data = await res.json();
      const parent = (data.incoming || []).find((l: any) => l.relationship === 'discussion_of');
      if (!parent) return;

      // Fetch recent messages from parent room
      const msgRes = await fetch(`/api/sessions/${parent.source_room_id}/messages?limit=20`);
      if (!msgRes.ok) return;
      const msgData = await msgRes.json();
      parentContext = {
        roomName: parent.source_name || 'Parent room',
        messages: msgData.messages || [],
      };
    } catch { /* no parent context — fine */ }
  }

  // Linked chat state
  let linkedChatId = $state('');
  let linkedChatMessages = $state<Record<string, unknown>[]>([]);
  let linkedChatHasMore = $state(false);
  let linkedChatLoadingMore = $state(false);
  let linkedChatScrollEl = $state<HTMLElement | null>(null);
  let messageSyncInFlight = false;
  let liveRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let sessionLoadSeq = 0;
  const LINKED_CHAT_PAGE_SIZE = 50;

  // Chat message search
  let chatSearchQuery = $state('');
  let chatSearchResults = $state<MessageSearchResult[]>([]);
  let chatSearchSelectedIndex = $state(0);
  let chatSearchLoading = $state(false);
  let chatSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let chatSearchRequestSeq = 0;

  const chatSearchSessionId = $derived(
    session?.type === 'terminal' ? (linkedChatId || '') : sessionId
  );
  const terminalHasCliDriver = $derived(session?.type === 'terminal' && !!session?.cli_flag);
  const activeSearchResult = $derived(chatSearchResults[chatSearchSelectedIndex] ?? null);
  const activeSearchResultId = $derived(activeSearchResult?.id ?? null);

  function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  function shellQuotePath(path: string): string {
    return shellQuote(path);
  }

  async function loadLinkedChat(chatId: string) {
    if (!chatId) return;
    const res = await fetch(`/api/sessions/${chatId}/messages?limit=${LINKED_CHAT_PAGE_SIZE}`);
    const data = await res.json();
    const msgs: Record<string, unknown>[] = data.messages || [];
    linkedChatMessages = msgs;
    linkedChatHasMore = msgs.length === LINKED_CHAT_PAGE_SIZE;
  }

  function newestMessageTimestamp(messages: Record<string, unknown>[]): string | null {
    let newest: string | null = null;
    for (const message of messages) {
      const createdAt = typeof message.created_at === 'string' ? message.created_at : null;
      if (createdAt && (!newest || createdAt > newest)) newest = createdAt;
    }
    return newest;
  }

  function overlapSinceTimestamp(createdAt: string | null): string | null {
    if (!createdAt) return null;
    const parsed = new Date(`${createdAt.replace(' ', 'T')}Z`);
    if (Number.isNaN(parsed.getTime())) return createdAt;
    return new Date(parsed.getTime() - 5000).toISOString().slice(0, 19).replace('T', ' ');
  }

  function appendUniqueMessages(
    current: Record<string, unknown>[],
    incoming: Record<string, unknown>[]
  ): { messages: Record<string, unknown>[]; added: boolean } {
    const seen = new Set(current.map((message) => String(message.id ?? '')));
    const next = [...current];
    let added = false;

    for (const message of incoming) {
      const id = String(message.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(message);
      added = true;
    }

    return { messages: next, added };
  }

  async function fetchCatchupMessages(chatId: string, current: Record<string, unknown>[]) {
    const since = overlapSinceTimestamp(newestMessageTimestamp(current));
    const url = since
      ? `/api/sessions/${chatId}/messages?since=${encodeURIComponent(since)}&limit=200`
      : `/api/sessions/${chatId}/messages?limit=200`;
    const res = await fetch(url);
    if (!res.ok) return { messages: current, added: false };
    const data = await res.json();
    return appendUniqueMessages(current, data.messages || []);
  }

  async function syncLiveMessages() {
    if (messageSyncInFlight || !session) return;
    const chatId = session.type === 'terminal' ? linkedChatId : sessionId;
    if (!chatId) return;

    messageSyncInFlight = true;
    const shouldStickToBottom = atBottom;
    try {
      if (session.type === 'terminal') {
        const result = await fetchCatchupMessages(chatId, linkedChatMessages);
        if (result.added) linkedChatMessages = result.messages;
      } else {
        const result = await fetchCatchupMessages(chatId, msgStore.messages as unknown as Record<string, unknown>[]);
        if (result.added) msgStore.messages = result.messages as unknown as typeof msgStore.messages;
      }
      if (shouldStickToBottom) requestAnimationFrame(() => scrollToBottom());
    } catch {
      // WS remains the primary live path; the catch-up loop retries quietly.
    } finally {
      messageSyncInFlight = false;
    }
  }

  function handleLiveRefreshWake() {
    if (!document.hidden) void syncLiveMessages();
    if (!ws || ws.readyState === WebSocket.CLOSED) connectWs();
  }

  function startLiveRefresh() {
    window.addEventListener('focus', handleLiveRefreshWake);
    document.addEventListener('visibilitychange', handleLiveRefreshWake);
    liveRefreshTimer = setInterval(() => {
      if (!document.hidden) void syncLiveMessages();
    }, 5000);
  }

  async function loadOlderLinkedChatMessages() {
    if (!linkedChatId || linkedChatLoadingMore || !linkedChatHasMore) return;
    const oldest = linkedChatMessages[0];
    if (!oldest) return;
    linkedChatLoadingMore = true;
    try {
      const before = (oldest.created_at as string) || '';
      const res = await fetch(
        `/api/sessions/${linkedChatId}/messages?before=${encodeURIComponent(before)}&limit=${LINKED_CHAT_PAGE_SIZE}`
      );
      const data = await res.json();
      const older: Record<string, unknown>[] = data.messages || [];
      if (older.length === 0) { linkedChatHasMore = false; return; }
      linkedChatHasMore = older.length === LINKED_CHAT_PAGE_SIZE;
      const el = linkedChatScrollEl;
      const prevScrollHeight = el ? el.scrollHeight : 0;
      linkedChatMessages = [...older, ...linkedChatMessages];
      if (el) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevScrollHeight; });
      }
    } finally {
      linkedChatLoadingMore = false;
    }
  }

  async function postToLinkedChat(text: string, replyToId: string | null = null) {
    if (!linkedChatId || !text.trim()) return;
    const routeIntoTerminal = terminalHasCliDriver;

    // LinkedChat only drives the PTY when this terminal has an explicit CLI driver.
    // Plain terminals keep the chat history, but do not surprise-run text as shell input.
    if (routeIntoTerminal && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text }));
      setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: '\r' }));
        }
      }, 150);
    }
    // Then record in chat history (async, non-blocking)
    const res = await fetch(`/api/sessions/${linkedChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user', content: text,
        format: 'text', sender_id: null, reply_to: replyToId, msg_type: 'message',
        meta: {
          source: routeIntoTerminal ? 'terminal_direct' : 'linked_chat_only',
          terminal_routing: routeIntoTerminal ? 'cli_driver' : 'chat_only_no_cli_driver',
        },
      }),
    });
    const msg = await res.json();
    if (msg.id && !linkedChatMessages.find(m => m.id === msg.id)) {
      linkedChatMessages = [...linkedChatMessages, msg];
    }
    if (!routeIntoTerminal && session?.type === 'terminal') {
      toasts.show('Saved to linked chat. Pick a CLI driver to send chat text into the terminal.');
    }
  }

  async function runChatSearch(query: string) {
    const trimmed = query.trim();
    const searchSessionId = session?.type === 'terminal' ? (linkedChatId || '') : sessionId;

    if (!trimmed || !searchSessionId) {
      chatSearchResults = [];
      chatSearchSelectedIndex = 0;
      chatSearchLoading = false;
      return;
    }

    const requestId = ++chatSearchRequestSeq;
    chatSearchLoading = true;

    try {
      const res = await fetch(
        `/api/sessions/${searchSessionId}/messages/search?q=${encodeURIComponent(trimmed)}&limit=100`
      );
      const data = await res.json();
      if (requestId !== chatSearchRequestSeq) return;

      const results = (data.results || []) as MessageSearchResult[];
      chatSearchResults = results;
      chatSearchSelectedIndex = 0;
    } catch {
      if (requestId !== chatSearchRequestSeq) return;
      chatSearchResults = [];
      chatSearchSelectedIndex = 0;
    } finally {
      if (requestId === chatSearchRequestSeq) chatSearchLoading = false;
    }
  }

  function clearChatSearch() {
    chatSearchQuery = '';
    chatSearchResults = [];
    chatSearchSelectedIndex = 0;
    chatSearchLoading = false;
    chatSearchRequestSeq++;
    if (chatSearchTimer) {
      clearTimeout(chatSearchTimer);
      chatSearchTimer = null;
    }
  }

  function selectChatSearchResult(index: number) {
    if (chatSearchResults.length === 0) return;
    const count = chatSearchResults.length;
    chatSearchSelectedIndex = ((index % count) + count) % count;
  }

  function selectNextChatSearchResult() {
    selectChatSearchResult(chatSearchSelectedIndex + 1);
  }

  function selectPrevChatSearchResult() {
    selectChatSearchResult(chatSearchSelectedIndex - 1);
  }

  async function ensureSearchResultLoaded(result: MessageSearchResult | null) {
    if (!result || session?.type !== 'terminal' || !linkedChatId) return;

    const targetId = result.id;
    while (
      activeSearchResultId === targetId &&
      linkedChatHasMore &&
      !linkedChatMessages.find((message) => message.id === targetId)
    ) {
      const previousCount = linkedChatMessages.length;
      await loadOlderLinkedChatMessages();
      if (linkedChatMessages.length === previousCount) break;
    }
  }

  async function wakeParticipant(targetSess: PageSession) {
    const handle = targetSess.handle;
    const chatSessions = allSessions.filter(s => s.type === 'chat');
    const chatRef = chatSessions.length > 0 ? chatSessions[0] : null;
    const replyCmd = chatRef ? `ant msg ${chatRef.id} "your reply here"` : 'ant msg <chat-session-id> "your reply here"';
    await fetch(`/api/sessions/${chatRef?.id || sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: `Hey ${targetSess.display_name || targetSess.name} — please check in and introduce yourself to the group. Reply using: \`${replyCmd}\``,
        format: 'text',
        sender_id: sessionId,
        target: handle,
        msg_type: 'message',
      }),
    });
    toasts.show(`Woke ${targetSess.display_name || targetSess.name}`);
  }

  async function addTerminalToRoom(targetSess: PageSession) {
    if (targetSess.type !== 'terminal') {
      toasts.show('Only terminal sessions can be added this way', 'error');
      return;
    }

    const label = targetSess.display_name || targetSess.name || targetSess.handle || 'terminal';
    const hello = `Hello, I am ${label}. I have joined the chatroom.`;
    const command = `ant chat send ${sessionId} --msg ${shellQuote(hello)}`;

    const send = async (data: string) => fetch(`/api/sessions/${targetSess.id}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });

    const first = await send(command);
    if (!first.ok) {
      toasts.show(`Failed to send join command to ${label}`, 'error');
      return;
    }
    setTimeout(() => {
      send('\r').catch(() => {});
    }, 150);
    toasts.show(`Sent join command to ${label}`);
  }

  async function stopParticipant(targetSess: PageSession) {
    if (targetSess.type !== 'terminal') {
      toasts.show('Only terminal sessions can be stopped', 'error');
      return;
    }

    const label = targetSess.display_name || targetSess.name || targetSess.handle || 'terminal';
    const res = await fetch(`/api/sessions/${targetSess.id}/terminal/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: `Stop button from ${session?.name || sessionId}`,
        requested_by: 'web',
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toasts.show(data.error || `Failed to stop ${label}`, 'error');
      return;
    }
    toasts.show(`Sent Ctrl-C to ${label}`);
  }

  // WS
  let ws = $state<WebSocket | null>(null);
  let wsDestroyed = false;
  const socket = $derived(ws);

  function joinCurrentWs(s: WebSocket) {
    if (s.readyState !== WebSocket.OPEN || !session) return;

    const isTerminal = session.type === 'terminal';
    console.log(`[WS] join: sessionId=${sessionId} type=${session.type} isTerminal=${isTerminal} linkedChatId=${linkedChatId}`);
    s.send(JSON.stringify({
      type: 'join_session',
      sessionId,
      spawnPty: isTerminal,
      cols: 120,
      rows: 40,
    }));
    if (linkedChatId && linkedChatId !== sessionId) {
      s.send(JSON.stringify({ type: 'join_session', sessionId: linkedChatId }));
    }
    s.send(JSON.stringify({ type: 'join_session', sessionId: 'SESSIONS_CHANNEL' }));
    void syncLiveMessages();
  }

  function connectWs() {
    if (wsDestroyed) return;
    if (ws?.readyState === WebSocket.OPEN) {
      joinCurrentWs(ws);
      return;
    }
    if (ws?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = new WebSocket(`${protocol}//${location.host}/ws`);
    ws = s;

    s.onopen = () => joinCurrentWs(s);

    s.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (linkedChatId && data.sessionId === linkedChatId) {
          if (data.type === 'message_created') {
            if (!linkedChatMessages.find(m => m.id === data.id)) {
              linkedChatMessages = [...linkedChatMessages, data];
              if (atBottom) requestAnimationFrame(() => scrollToBottom());
            }
          } else if (data.type === 'message_updated') {
            linkedChatMessages = linkedChatMessages.map(m =>
              m.id === data.msgId ? { ...m, meta: JSON.stringify(data.meta) } : m
            );
          } else if (data.type === 'message_deleted') {
            linkedChatMessages = linkedChatMessages.filter(m => m.id !== data.msgId);
          }
          return;
        }

        // Refresh allSessions + postsFrom when sessions change globally
        if (data.type === 'sessions_changed') {
          fetch('/api/sessions').then(r => r.json()).then(d => { allSessions = d.sessions || []; }).catch(() => {});
          loadMentionHandles(); // also refreshes postsFrom
          return;
        }

        if (data.sessionId && data.sessionId !== sessionId) return;

        switch (data.type) {
          case 'message_created':
            if (!msgStore.messages.find(m => m.id === data.id)) {
              msgStore.messages = [...msgStore.messages, data];
              if (data.sender_id && !mentionHandles.find(h => h.handle === data.sender_id)) {
                loadMentionHandles();
              }
            }
            break;
          case 'message_updated':
            msgStore.messages = msgStore.messages.map(m =>
              m.id === data.msgId ? { ...m, meta: JSON.stringify(data.meta) } : m
            );
            break;
          case 'message_deleted':
            msgStore.messages = msgStore.messages.filter(m => m.id !== data.msgId);
            break;
          case 'run_event_created':
            if (data.event) appendRunEvent(data.event as RunEvent);
            break;
          case 'task_created':
            if (data.task && !tasks.find(t => t.id === data.task.id)) tasks = [...tasks, data.task];
            break;
          case 'task_updated':
            tasks = tasks.map(t => t.id === data.task?.id ? data.task : t);
            break;
          case 'task_deleted':
            tasks = tasks.map(t => t.id === data.taskId ? { ...t, status: 'deleted' } : t);
            break;
          case 'file_ref_created':
            if (data.ref && !fileRefs.find(r => r.id === data.ref.id)) fileRefs = [...fileRefs, data.ref];
            break;
          case 'file_ref_deleted':
            fileRefs = fileRefs.filter(r => r.id !== data.refId);
            break;
          case 'handle_updated':
            session = { ...session!, handle: data.handle as string | undefined, display_name: data.display_name as string | undefined };
            break;
          case 'cli_flag_updated':
            session = { ...session!, cli_flag: data.cli_flag as string | null };
            break;
          case 'message_read':
            // Real-time read receipt update from WS broadcast
            if (data.reads && data.messageId) {
              readReceipts = { ...readReceipts, [data.messageId]: data.reads };
            }
            break;
        }
      } catch {}
    };

    s.onclose = () => { if (!wsDestroyed) setTimeout(connectWs, 2000); };
  }

  function resetSessionState() {
    session = null;
    mode = 'chat';
    showMenu = false;
    replyTo = null;
    showDigest = false;
    runEvents = [];
    runEventsLoaded = false;
    runSearchQuery = '';
    runEventsLoading = false;
    tasks = [];
    fileRefs = [];
    uploads = [];
    mentionHandles = [];
    roomParticipants = [];
    postsFrom = [];
    linkedChatId = '';
    linkedChatMessages = [];
    linkedChatHasMore = false;
    linkedChatLoadingMore = false;
    workspaces = [];
    chatSearchQuery = '';
    chatSearchResults = [];
    chatSearchSelectedIndex = 0;
    chatSearchLoading = false;
    chatSearchRequestSeq++;
    readReceipts = {};
    msgStore.messages = [];
    if (terminalSpawnTimer) {
      clearTimeout(terminalSpawnTimer);
      terminalSpawnTimer = null;
    }
  }

  function scheduleTerminalSpawn(targetSessionId: string) {
    if (terminalSpawnTimer) clearTimeout(terminalSpawnTimer);
    terminalSpawnTimer = setTimeout(() => {
      if (sessionId !== targetSessionId) return;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'join_session',
          sessionId: targetSessionId,
          spawnPty: true,
          cols: 120,
          rows: 40,
        }));
      }
    }, 1000);
  }

  async function loadSessionPage(targetSessionId: string) {
    const loadSeq = ++sessionLoadSeq;
    resetSessionState();

    const [sessRes, allSessRes] = await Promise.all([
      fetch(`/api/sessions/${targetSessionId}`),
      fetch('/api/sessions'),
    ]);
    const loadedSession = await sessRes.json();
    const loadedSessions = (await allSessRes.json()).sessions || [];
    if (loadSeq !== sessionLoadSeq || targetSessionId !== sessionId) return;

    session = loadedSession;
    allSessions = loadedSessions;
    const wideChatLayout = window.matchMedia('(min-width: 1024px)').matches;
    showPanel = wideChatLayout;

    if (session?.type === 'terminal' && session) {
      if (session.linked_chat_id) {
        linkedChatId = session.linked_chat_id;
        await loadLinkedChat(session.linked_chat_id);
      }
    }

    if (session?.type !== 'terminal') await msgStore.load(targetSessionId);
    if (loadSeq !== sessionLoadSeq || targetSessionId !== sessionId) return;
    requestAnimationFrame(() => scrollToBottom());

    const [tasksRes, refsRes, uploadsRes, workspacesRes] = await Promise.all([
      fetch(`/api/sessions/${targetSessionId}/tasks`),
      fetch(`/api/sessions/${targetSessionId}/file-refs`),
      fetch(`/api/sessions/${targetSessionId}/attachments`),
      fetch('/api/workspaces'),
    ]);
    if (loadSeq !== sessionLoadSeq || targetSessionId !== sessionId) return;
    tasks = (await tasksRes.json()).tasks || [];
    fileRefs = (await refsRes.json()).refs || [];
    uploads = (await uploadsRes.json()).uploads || [];
    const workspaceData = await workspacesRes.json();
    workspaces = Array.isArray(workspaceData) ? workspaceData : (workspaceData.workspaces || []);
    loadMentionHandles(
      session?.type === 'terminal' && linkedChatId ? linkedChatId : targetSessionId,
      targetSessionId,
    );

    // Load read receipts for the active chat
    const readChatId = session?.type === 'terminal' ? session?.linked_chat_id : targetSessionId;
    if (readChatId) loadReadReceipts(readChatId, targetSessionId);

    // Load parent context for discussion rooms
    if (session?.type === 'chat') loadParentContext();

    connectWs();

    // After WS connects, ensure the terminal PTY is spawned by sending
    // a second join_session with spawnPty after a short delay. The onopen
    // handler should do this but has timing issues on fresh sessions.
    if (session?.type === 'terminal') {
      scheduleTerminalSpawn(targetSessionId);
    }
    loadMemories();
  }

  // ── B1 — Folder navigation drawer (visible button + Cmd+P shortcut) ──
  let folderDrawerOpen = $state(false);
  // ── Export sheet — UI affordance over POST /api/sessions/:id/export ──
  let exportSheetOpen = $state(false);

  function onGlobalKeydown(e: KeyboardEvent) {
    // Cmd+P opens the folder drawer on Mac; Ctrl+P remains a non-Mac fallback.
    // Suppressed when typing into an input/textarea/contenteditable so the user
    // can still print or paste text without triggering the drawer.
    if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey && !e.altKey) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (!isEditable) {
        e.preventDefault();
        folderDrawerOpen = true;
      }
    }
  }

  function pasteCdToTerminal(path: string) {
    if (!path) return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    // Plain-text PTY injection per project rule: text first, 150ms gap, then \r.
    socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: `cd ${shellQuotePath(path)}` }));
    setTimeout(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: '\r' }));
      }
    }, 150);
  }

  onMount(() => {
    startLiveRefresh();
    if (typeof window !== 'undefined') window.addEventListener('keydown', onGlobalKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onGlobalKeydown);
  });

  $effect(() => {
    const targetSessionId = sessionId;
    if (!targetSessionId) return;
    void loadSessionPage(targetSessionId);
  });

  $effect(() => {
    if (mode === 'terminal' && session?.type === 'terminal') {
      void refreshRunEvents(); // one-time load, then WS appends
    }
  });

  $effect(() => {
    const query = chatSearchQuery;
    const searchSession = chatSearchSessionId;

    if (chatSearchTimer) {
      clearTimeout(chatSearchTimer);
      chatSearchTimer = null;
    }

    if (!query.trim()) {
      chatSearchResults = [];
      chatSearchSelectedIndex = 0;
      chatSearchLoading = false;
      return;
    }

    if (mode !== 'chat' || !searchSession) {
      chatSearchLoading = false;
      return;
    }

    chatSearchLoading = true;
    chatSearchTimer = setTimeout(() => {
      void runChatSearch(query);
    }, 250);

    return () => {
      if (chatSearchTimer) {
        clearTimeout(chatSearchTimer);
        chatSearchTimer = null;
      }
    };
  });

  $effect(() => {
    const result = activeSearchResult;
    if (!result || mode !== 'chat') return;
    void ensureSearchResultLoaded(result);
  });

  onDestroy(() => {
    wsDestroyed = true;
    ws?.close();
    window.removeEventListener('focus', handleLiveRefreshWake);
    document.removeEventListener('visibilitychange', handleLiveRefreshWake);
    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
    if (terminalSpawnTimer) clearTimeout(terminalSpawnTimer);
    if (cmdPoll !== null) clearInterval(cmdPoll);
  });

  async function publishSummary() {
    if (!linkedChatId) {
      toasts.show('No linked chat to publish from');
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${linkedChatId}/publish-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Interview summary: ${session?.name || 'Untitled'}`,
          findings: [],
          decisions: [],
          asks: [],
          actions: [],
          sources: linkedChatMessages
            .filter((m: any) => m.id)
            .map((m: any) => ({ message_id: m.id, excerpt: String(m.content || '').slice(0, 120) })),
          authored_by: session?.handle || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toasts.show(`Summary published to room ${result.origin_room_id}`);
    } catch (e: any) {
      toasts.show(`Publish failed: ${e.message}`);
    }
  }

  async function sendMessage(text: string, replyToId: string | null = null) {
    await msgStore.send(sessionId, text, { reply_to: replyToId });
    await loadUploads(sessionId);
    replyTo = null;

    // M2 #1 — interview trigger via @mention
    const mentionHandles = allSessions
      .filter((s) => s.handle)
      .map((s) => ({ handle: s.handle!, name: s.display_name || s.name || s.handle! }));
    const interviewTargets = interviewMentions(text, mentionHandles);
    for (const target of interviewTargets) {
      const targetSession = allSessions.find((s) => s.handle === target.handle);
      if (!targetSession) continue;
      try {
        const res = await fetch(`/api/sessions/${targetSession.id}/start-interview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin_room_id: sessionId, caller_handle: session?.handle || null }),
        });
        if (!res.ok) continue;
        const result = await res.json();
        if (result?.ok && result?.created) {
          toasts.show(`Started interview with ${targetSession.display_name || targetSession.name || targetSession.handle}`);
        }
      } catch {
        // Silently ignore interview trigger failures
      }
    }
  }

  async function sendCommand(cmd: string) {
    const text = cmd.endsWith('\n') || cmd.endsWith('\r') ? cmd.slice(0, -1) : cmd;
    // Two-call protocol: text first, then \r separately after 50ms
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text }));
      setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: '\r' }));
        }
      }, 150);
    }
    // Also save to linked chat history (async, non-blocking)
    if (linkedChatId) {
      fetch(`/api/sessions/${linkedChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user', content: text,
          format: 'text', sender_id: null, msg_type: 'message',
          meta: { source: 'terminal_direct' },
        }),
      }).catch(() => {});
    }
  }

  async function copySessionId() {
    await navigator.clipboard.writeText(sessionId);
    showMenu = false;
  }

  async function renameSession(newName: string) {
    const trimmed = normalizeSessionName(newName || '');
    if (!trimmed || trimmed === session?.name) return;
    showMenu = false;
    try {
      const updatedSession = await sessionStore.renameSession(sessionId, trimmed);
      session = { ...session!, ...updatedSession, name: trimmed };
      allSessions = [...sessionStore.sessions];
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Failed to rename session', 'error');
    }
  }

  async function deleteSession() {
    if (!confirm(`Delete session "${session?.name}"? This cannot be undone.`)) return;
    showMenu = false;
    await sessionStore.deleteSession(sessionId);
    goto('/');
  }

  async function createTask(title: string) {
    const res = await fetch(`/api/sessions/${sessionId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, created_by: sessionId }),
    });
    const data = await res.json();
    if (data.task && !tasks.find(t => t.id === data.task.id)) tasks = [...tasks, data.task];
  }

  async function saveNickname(sess: PageSession, handle: string) {
    const full = handle.startsWith('@') ? handle : `@${handle}`;
    const res = await fetch(`/api/sessions/${sess.id}/handle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: full }),
    });
    if (res.ok) {
      const updated = await res.json();
      allSessions = allSessions.map(s => s.id === sess.id ? { ...s, handle: updated.handle } : s);
    }
  }

  async function removeParticipant(sess: PageSession) {
    const label = sess.display_name || sess.name || sess.handle || sess.id;
    if (!confirm(`Remove ${label} from this room?`)) return;

    const res = await fetch(`/api/sessions/${sessionId}/participants?session_id=${encodeURIComponent(sess.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toasts.show('Failed to remove participant', 'error');
      return;
    }

    roomParticipants = roomParticipants.filter((p) => p.id !== sess.id);
    mentionHandles = mentionHandles.filter((h) => h.handle !== sess.handle);
    postsFrom = postsFrom.filter((p) => p.id !== sess.id);
    toasts.show(`Removed ${label}`);
    await loadMentionHandles();
  }

  async function setParticipantFocus(sess: PageSession) {
    const label = sess.display_name || sess.name || sess.handle || sess.id;
    const isFocused = sess.attention_state === 'focus';
    let reason = '';
    if (!isFocused) {
      reason = prompt(`Focus reason for ${label}`, sess.attention_reason || 'building')?.trim() || '';
      if (!reason) {
        toasts.show('Focus reason required', 'error');
        return;
      }
    }

    const res = await fetch(`/api/sessions/${sessionId}/participants`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sess.id,
        attention_state: isFocused ? 'available' : 'focus',
        ttl: '30m',
        reason,
        set_by: 'web',
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toasts.show(data.error || 'Failed to update focus', 'error');
      return;
    }
    toasts.show(isFocused ? `Focus cleared for ${label}` : `${label} is now in focus mode`);
    await loadMentionHandles();
  }

  function openLinkedChat(sess: PageSession) {
    const targetId = sess.type === 'terminal' && sess.linked_chat_id ? sess.linked_chat_id : sess.id;
    goto(`/session/${targetId}`);
  }

  async function handleCliFlagChange(slug: string | null) {
    // PATCH persists cli_flag, updates meta, notifies daemon, and broadcasts WS
    await fetch(`/api/sessions/${sessionId}/cli-flag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cli_flag: slug }),
    });
    // Update local state immediately (WS broadcast will also arrive, but this is faster)
    session = { ...session!, cli_flag: slug };
  }

  async function handleChangeTtl(ttl: string) {
    await sessionStore.updateTtl(sessionId, ttl);
    session = { ...session!, ttl };
    toasts.show(`Persistence changed to ${ttl === 'forever' ? 'Always On' : ttl}`);
  }

  async function jumpToWorkspace(workspace: WorkspaceOption) {
    const rootDir = workspace.root_dir?.trim();
    if (!rootDir || session?.type !== 'terminal') return;

    const command = `cd ${shellQuotePath(rootDir)}`;
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root_dir: rootDir }),
    });
    session = { ...session!, root_dir: rootDir };
    await sendCommand(command);
    toasts.show(`Changed folder to ${workspace.name || rootDir}`);
  }

  async function crossPost(targetId: string, text: string) {
    const targetSess = allSessions.find(s => s.id === targetId);
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: text,
        format: 'text',
        sender_id: sessionId,
        target: targetSess?.handle || null,
        msg_type: 'message',
      }),
    });
    const msg = await res.json();
    if (msg.id && !msgStore.messages.find(m => m.id === msg.id)) {
      msgStore.messages = [...msgStore.messages, msg];
    }
    const name = targetSess?.display_name || targetSess?.name || 'session';
    toasts.show(`Posted to ${name}`);
  }

  async function handleAgentRespond(targetSessionId: string, payload: unknown) {
    await fetch(`/api/sessions/${targetSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        msg_type: 'agent_response',
        content: JSON.stringify(payload),
      }),
    });
  }

  // Derived state passed to components
  const activeTasks = $derived(tasks.filter(t => t.status !== 'deleted'));
  const openTaskCount = $derived(activeTasks.filter(t => !['complete'].includes(t.status)).length);

  const bookmarkedMessages = $derived(
    (msgStore.messages.filter(m => {
      try { return JSON.parse(m.meta || '{}').bookmarked; } catch { return false; }
    })) as unknown as Record<string, unknown>[]
  );

  function roomIdentitySession(p: Record<string, unknown>): PageSession | null {
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) return null;

    const handle = typeof p.handle === 'string' && p.handle
      ? p.handle
      : typeof p.alias === 'string' && p.alias
        ? p.alias
        : undefined;
    const name = typeof p.name === 'string' && p.name ? p.name : handle || id;
    const displayName = typeof p.display_name === 'string' && p.display_name
      ? p.display_name
      : name;

    return {
      id,
      name,
      type: (typeof p.session_type === 'string' && p.session_type)
        ? p.session_type
        : (typeof p.type === 'string' && p.type) ? p.type : 'external',
      handle,
      alias: typeof p.alias === 'string' ? p.alias : null,
      display_name: displayName,
      cli_flag: typeof p.cli_flag === 'string' ? p.cli_flag : null,
      attention_state: typeof p.attention_state === 'string' ? p.attention_state : null,
      attention_reason: typeof p.attention_reason === 'string' ? p.attention_reason : null,
      attention_set_by: typeof p.attention_set_by === 'string' ? p.attention_set_by : null,
      attention_expires_at: typeof p.attention_expires_at === 'number'
        ? p.attention_expires_at
        : (typeof p.attention_expires_at === 'string' && p.attention_expires_at ? Number(p.attention_expires_at) : null),
      focus_queue_count: typeof p.focus_queue_count === 'number' ? p.focus_queue_count : null,
    };
  }

  const messageIdentitySessions = $derived.by(() => {
    const byId = new Map<string, PageSession>();
    const add = (s: PageSession | null) => {
      if (!s?.id) return;
      byId.set(s.id, { ...byId.get(s.id), ...s });
    };

    allSessions.forEach(add);
    roomParticipants.map(roomIdentitySession).forEach(add);
    postsFrom.map(roomIdentitySession).forEach(add);

    return [...byId.values()];
  });

  const participants = $derived.by(() => {
    const counts = new Map();
    for (const m of msgStore.messages) {
      if (!m.sender_id) continue;
      const key = allSessions.find(s => s.handle === m.sender_id || s.id === m.sender_id)?.id ?? m.sender_id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const roomMemberIds = new Set(roomParticipants.map((p) => p.id as string));
    const hasRoomMembership = roomParticipants.length > 0;
    const active = allSessions
      .filter(s => s.id !== sessionId && (hasRoomMembership ? roomMemberIds.has(s.id) : counts.has(s.id)))
      .map(s => {
        const roomInfo = roomParticipants.map(roomIdentitySession).find(p => p?.id === s.id);
        return { sess: { ...s, ...roomInfo }, count: counts.get(s.id) ?? 0, active: true };
      });
    const activeIds = new Set(active.map(p => p.sess.id));

    // Include external posters (e.g. @gemini) that don't match any session
    const externalActive = postsFrom
      .filter((p: Record<string, unknown>) => !activeIds.has(p.id as string))
      .map((p: Record<string, unknown>) => ({
        sess: {
          id: p.id as string,
          name: (p.name as string) || (p.id as string),
          type: 'external',
          handle: (p.handle as string) || null,
          display_name: (p.name as string) || (p.id as string),
        } as PageSession,
        count: counts.get(p.id as string) ?? (p.message_count as number) ?? 0,
        active: true,
      }));

    const available = allSessions
      .filter(s => s.id !== sessionId && !activeIds.has(s.id))
      .map(s => ({ sess: s, count: 0, active: false }));
    return { active: [...active, ...externalActive], available };
  });

  // Messages to show in chat area: linked chat for terminals, msgStore for chat sessions
  const displayMessages = $derived(
    (session?.type === 'terminal' ? linkedChatMessages : msgStore.messages) as Record<string, unknown>[]
  );

  // Read receipts state — keyed by message_id → array of readers
  let readReceipts = $state<Record<string, { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }[]>>({});

  async function loadReadReceipts(chatId: string, targetSessionId = sessionId) {
    try {
      const res = await fetch(`/api/sessions/${chatId}/reads`);
      const data = await res.json();
      if (targetSessionId !== sessionId) return;
      readReceipts = data.reads || {};
    } catch {}
  }

  // Mark visible messages as read (fires on scroll settle + new messages)
  let readMarkTimer: ReturnType<typeof setTimeout> | null = null;
  function markVisibleMessagesAsRead() {
    if (readMarkTimer) clearTimeout(readMarkTimer);
    readMarkTimer = setTimeout(async () => {
      const chatId = session?.type === 'terminal' ? linkedChatId : sessionId;
      if (!chatId) return;
      const readerId = session?.type === 'terminal' ? sessionId : sessionId;
      const msgs = displayMessages;
      // Mark the last 5 visible messages as read (lightweight)
      const recent = msgs.slice(-5);
      for (const msg of recent) {
        const msgId = msg.id as string;
        const existingReads = readReceipts[msgId] || [];
        if (existingReads.some(r => r.session_id === readerId)) continue;
        fetch(`/api/sessions/${chatId}/messages/${msgId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reader_id: readerId }),
        }).catch(() => {});
      }
    }, 1000);
  }
</script>

<div class="h-screen w-screen flex overflow-hidden" style="background: var(--bg); color: var(--text);">
  <!-- Activity Rail — persistent session switcher -->
  <ActivityRail currentSessionId={sessionId} />

  <!-- Main content column -->
  <div class="flex-1 flex flex-col overflow-hidden min-w-0">
  <!-- Toolbar -->
  <ChatHeader
    {session}
    {mode}
    {showPanel}
    {showMenu}
    {sessionId}
    {openTaskCount}
    onModeChange={(m) => (mode = m)}
    onPanelToggle={() => (showPanel = !showPanel)}
    onMenuToggle={() => (showMenu = !showMenu)}
    onMenuClose={() => (showMenu = false)}
    onCopyId={copySessionId}
    onRename={renameSession}
    onDelete={deleteSession}
    onCliFlagChange={handleCliFlagChange}
    onChangeTtl={handleChangeTtl}
    onCopyTmux={() => {
      const cmd = `ssh ${window.location.hostname} -t tmux attach-session -t ${sessionId}`;
      navigator.clipboard.writeText(cmd).then(() => {
        toasts.show('Copied tmux command to clipboard');
      }).catch(() => {
        // Fallback for when clipboard API is blocked
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toasts.show('Copied tmux command to clipboard');
      });
    }}
    onDigestToggle={() => (showDigest = !showDigest)}
    onOpenFolders={session?.type === 'terminal' ? () => (folderDrawerOpen = true) : undefined}
    onOpenExport={() => (exportSheetOpen = true)}
    onCreateDiscussion={session?.type === 'chat' ? async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Discussion: ${session?.name || sessionId}` }),
        });
        if (res.ok) {
          const data = await res.json();
          goto(`/session/${data.targetRoomId}`);
        }
      } catch {}
    } : undefined}
  />

  {#if showDigest}
    <DigestPanel {sessionId} onClose={() => (showDigest = false)} />
  {/if}

  <!-- Body -->
  <div class="flex flex-1 overflow-hidden min-h-0">
    <!-- Main -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      {#if mode === 'chat'}
        <ChatMessages
          messages={displayMessages}
          {sessionId}
          {session}
          allSessions={messageIdentitySessions}
          participantsActive={participants.active}
          {linkedChatId}
          {linkedChatHasMore}
          {linkedChatLoadingMore}
          {terminalHasCliDriver}
          {replyTo}
          {atBottom}
          {mentionHandles}
          {readReceipts}
          searchQuery={chatSearchQuery}
          searchResults={chatSearchResults}
          searchSelectedIndex={chatSearchSelectedIndex}
          searchLoading={chatSearchLoading}
          activeSearchResultId={activeSearchResultId}
          onSend={sendMessage}
          onPostToLinkedChat={postToLinkedChat}
          onLoadOlder={loadOlderLinkedChatMessages}
          onScrollToBottom={scrollToBottom}
          onSearchQueryChange={(value) => { chatSearchQuery = value; }}
          onSearchNext={selectNextChatSearchResult}
          onSearchPrev={selectPrevChatSearchResult}
          onSearchClear={clearChatSearch}
          onMessageDeleted={(id) => { msgStore.messages = msgStore.messages.filter(x => x.id !== id); }}
          onMessageMetaUpdated={(id, meta) => { msgStore.messages = msgStore.messages.map(x => x.id === id ? { ...x, meta: JSON.stringify(meta) } : x); }}
          onLinkedMessageDeleted={(id) => { linkedChatMessages = linkedChatMessages.filter(x => x.id !== id); }}
          onLinkedMessageMetaUpdated={(id, meta) => { linkedChatMessages = linkedChatMessages.map(x => x.id === id ? { ...x, meta: JSON.stringify(meta) } : x); }}
          onMessagePinToggled={(id, pinned) => { msgStore.messages = msgStore.messages.map(x => x.id === id ? { ...x, pinned } : x); }}
          onLinkedMessagePinToggled={(id, pinned) => { linkedChatMessages = linkedChatMessages.map(x => x.id === id ? { ...x, pinned } : x); }}
          onReply={(msg) => { replyTo = msg; }}
          onClearReply={() => (replyTo = null)}
          onAgentRespond={handleAgentRespond}
          onScrollElMounted={(el) => { chatScrollEl = el; }}
          onScroll={onChatScroll}
          {parentContext}
          {shortcutScope}
        />
      {:else if mode === 'terminal'}
        <!-- ANT Terminal mode — normalized append-only run events -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <!-- Toolbar -->
          <div class="flex items-center px-4 py-2 border-b gap-3 flex-shrink-0" style="border-color: #E5E7EB; background: var(--bg);">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #22C55E;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
              <span class="text-xs font-semibold" style="color: var(--text);">ANT Terminal</span>
              <span class="hidden sm:inline text-[11px]" style="color: var(--text-faint);">
                interpreted run events
              </span>
            </div>
            <div class="flex-1"></div>
            <!-- Noise filters -->
            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onclick={() => (runShowStatusEvents = !runShowStatusEvents)}
                class="px-2 py-1.5 rounded-lg text-[11px] font-mono transition-all"
                style="
                  border: 1px solid {runShowStatusEvents ? '#22C55E66' : '#E5E7EB'};
                  background: {runShowStatusEvents ? '#22C55E18' : 'var(--bg-surface)'};
                  color: {runShowStatusEvents ? '#15803D' : 'var(--text-faint)'};
                "
                title={runShowStatusEvents ? 'Hide status update events' : 'Show status update events'}
              >Status</button>
              <button
                type="button"
                onclick={() => (runShowProgressEvents = !runShowProgressEvents)}
                class="px-2 py-1.5 rounded-lg text-[11px] font-mono transition-all"
                style="
                  border: 1px solid {runShowProgressEvents ? '#3B82F666' : '#E5E7EB'};
                  background: {runShowProgressEvents ? '#3B82F618' : 'var(--bg-surface)'};
                  color: {runShowProgressEvents ? '#2563EB' : 'var(--text-faint)'};
                "
                title={runShowProgressEvents ? 'Hide progress events' : 'Show progress events'}
              >Progress</button>
            </div>
            <!-- Search input -->
            <div class="relative" style="width: 200px;">
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #9CA3AF;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
              </svg>
              <input
                bind:value={runSearchQuery}
                class="w-full text-xs rounded-lg pl-8 pr-3 py-1.5 outline-none"
                style="border: 1px solid #E5E7EB; background: #F9FAFB; color: var(--text);"
                placeholder="Search run…"
              />
            </div>
            <!-- Refresh -->
            <button
              onclick={() => refreshRunEvents(true)}
              class="touch-target p-1.5 rounded-lg transition-all"
              style="color: var(--text-muted); border: 1px solid #E5E7EB;"
              title="Refresh ANT Terminal"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>
          <RunView
            events={runEvents}
            {sessionId}
            searchQuery={runSearchQuery}
            showStatusEvents={runShowStatusEvents}
            showProgressEvents={runShowProgressEvents}
          />
          {#if runEventsLoading && runEvents.length === 0}
            <div class="px-4 py-2 text-xs border-t" style="color: var(--text-faint); border-color: var(--border-subtle);">
              Loading ANT Terminal…
            </div>
          {/if}
          <!-- Special key buttons -->
          {#await import('$lib/shared/special-keys.js') then mod}
            <div class="flex items-center gap-1 px-3 py-1 min-h-[52px] border-t shrink-0 overflow-x-auto scrollbar-none" style="border-color:#1E293B; background:#161B22;">
              {#each mod.SPECIAL_KEYS as key}
                <button
                  onclick={() => {
                    if (key.seq === '__paste__') {
                      navigator.clipboard.readText().then(t => {
                        if (socket?.readyState === WebSocket.OPEN) {
                          socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: t }));
                          setTimeout(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: '\r' })); }, 150);
                        }
                      });
                    } else {
                      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: key.seq }));
                    }
                  }}
                  class="touch-target shrink-0 px-2.5 py-1 rounded text-[11px] font-mono transition-colors hover:bg-[#21262D]"
                  style="color:#8B949E; border:1px solid #30363D;"
                >{key.label}</button>
              {/each}
            </div>
          {/await}
          <CLIInput onSubmit={sendCommand}/>
        </div>
      {:else if mode === 'raw'}
        <!-- Raw terminal mode (xterm.js) -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <div class="flex items-center px-3 py-1.5 border-b gap-2" style="border-color:var(--border-light);background:var(--bg-surface);">
            <span class="text-xs font-medium" style="color:var(--text-muted);">🖥 Raw Terminal</span>
            <div class="flex-1"></div>
            <button
              onclick={() => termKey++}
              class="touch-target p-1.5 rounded transition-all"
              style="color:var(--text-faint);"
              title="Refresh terminal (remount)"
              aria-label="Refresh terminal"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
            <div class="flex-1"></div>
          </div>
          <div class="flex-1 min-h-0 flex flex-col" style="background:var(--terminal-bg);">
            {#key termKey}<Terminal {sessionId}/>{/key}
          </div>
          <CLIInput onSubmit={sendCommand}/>
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center text-sm" style="color: var(--text-muted);">
          Unknown view mode.
        </div>
      {/if}
    </div>

    <!-- Side panel — hidden in terminal text mode (full-width) -->
    {#if effectiveShowPanel}
      <!-- Mobile backdrop: tap to dismiss -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fixed inset-0 z-40 bg-black/40 lg:hidden"
        onclick={() => (showPanel = false)}
        ontouchstart={(e) => beginPanelSwipe(e, 'close')}
        ontouchmove={movePanelSwipe}
      ></div>
      <ChatSidePanel
        {session}
        {sessionId}
        {panelTab}
        {tasks}
        {fileRefs}
        {uploads}
        {workspaces}
        {allSessions}
        {linkedChatId}
        {linkedChatMessages}
        referenceMessages={displayMessages}
        {linkedChatHasMore}
        {linkedChatLoadingMore}
        {activeTasks}
        {openTaskCount}
        {bookmarkedMessages}
        {memories}
        {memorySearch}
        {memorySearchResults}
        {memorySearching}
        {postsFrom}
        participantsActive={participants.active}
        participantsAvailable={participants.available}
        onTabChange={(tab) => (panelTab = tab)}
        onTaskUpdated={(u) => { tasks = tasks.map(x => x.id === u.id ? u : x); }}
        onFileRefRemoved={(id) => { fileRefs = fileRefs.filter(x => x.id !== id); }}
        onWorkspaceJump={jumpToWorkspace}
        onLinkedChatIdChange={(id) => {
          linkedChatId = id;
          if (id) loadMentionHandles(id, sessionId);
        }}
        onLoadLinkedChat={loadLinkedChat}
        onLoadOlderLinkedChat={loadOlderLinkedChatMessages}
        onPostToLinkedChat={postToLinkedChat}
        onAgentRespond={handleAgentRespond}
        onAddMemory={addMemory}
        onDeleteMemory={deleteMemory}
        onMemorySearchChange={(q) => (memorySearch = q)}
        onCrossPost={crossPost}
        onWakeParticipant={wakeParticipant}
        onSaveNickname={saveNickname}
        onRemoveParticipant={removeParticipant}
        onFocusParticipant={setParticipantFocus}
        onOpenLinkedChat={openLinkedChat}
        onPublishSummary={publishSummary}
        onAddTerminalToRoom={addTerminalToRoom}
        onStopParticipant={stopParticipant}
        onOpenFolderDrawer={() => (folderDrawerOpen = true)}
        onCreateTask={createTask}
        onClose={() => (showPanel = false)}
      />
    {:else}
      <button
        type="button"
        class="ios-panel-edge-handle lg:hidden"
        aria-label="Open side panel"
        title="Open side panel"
        onclick={() => (showPanel = true)}
        ontouchstart={(e) => beginPanelSwipe(e, 'open')}
        ontouchmove={movePanelSwipe}
      >
        <span aria-hidden="true"></span>
      </button>
    {/if}
  </div>
  </div><!-- /main content column -->
</div>

<!-- B1: folder navigation drawer (visible button + Cmd+P shortcut) -->
<FolderDrawer
  open={folderDrawerOpen}
  {workspaces}
  onSelect={pasteCdToTerminal}
  onClose={() => (folderDrawerOpen = false)}
/>

<!-- Export sheet: UI affordance over POST /api/sessions/:id/export -->
<ExportSheet
  open={exportSheetOpen}
  {sessionId}
  onClose={() => (exportSheetOpen = false)}
/>

<!-- P0: left-edge back-nav gutter — captures right-swipe before xterm canvas
     receives it, navigates back to the dashboard. Mobile only via lg:hidden. -->
<div
  class="ios-back-edge-gutter lg:hidden"
  ontouchstart={beginBackSwipe}
  ontouchmove={moveBackSwipe}
  ontouchend={endBackSwipe}
  ontouchcancel={endBackSwipe}
  aria-hidden="true"
></div>

<style>
  .ios-back-edge-gutter {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 8px;
    z-index: 60;
    /* Subtle translucent strip — visible enough to hint at the gesture
       without competing with content. Falls back to transparent on
       devices that don't support color-mix. */
    background: color-mix(in srgb, var(--text-faint) 14%, transparent);
    touch-action: pan-y;
  }

  .ios-panel-edge-handle {
    position: fixed;
    top: 50%;
    right: var(--ant-safe-right, 0px);
    z-index: 35;
    width: 28px;
    min-height: 88px;
    transform: translateY(-50%);
    border: 0;
    border-radius: 999px 0 0 999px;
    background: color-mix(in srgb, var(--bg-card) 88%, transparent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14), inset 1px 0 0 var(--border-subtle);
    color: var(--text-faint);
    cursor: pointer;
    touch-action: pan-y;
    backdrop-filter: blur(8px);
  }

  .ios-panel-edge-handle span {
    display: block;
    width: 4px;
    height: 32px;
    margin: 0 auto;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.65;
  }
</style>
