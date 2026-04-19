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
  import { useToasts } from '$lib/stores/toast.svelte';
  import { normalizeSessionName } from '$lib/utils/session-naming';
  import { onMount, onDestroy } from 'svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
    ttl?: string;
    cli_flag?: string | null;
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

  const toasts = useToasts();

  const sessionId = $derived($page.params.id as string);
  const msgStore = useMessageStore();
  const sessionStore = useSessionStore();

  let session = $state<PageSession | null>(null);
  let allSessions = $state<PageSession[]>([]);
  let mode = $state('chat');
  let showMenu = $state(false);
  // Panel closed by default on thin/mobile browsers (<1024px), open on desktop
  let showPanel = $state(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  let panelTab = $state('participants');

  // Hide side panel in terminal text mode (full-width dark view)
  const effectiveShowPanel = $derived(showPanel && mode !== 'terminal');

  let tasks = $state<{ id: string; status: string; [key: string]: unknown }[]>([]);
  let fileRefs = $state<{ id: string; file_path?: string; [key: string]: unknown }[]>([]);
  let replyTo = $state<Record<string, unknown> | null>(null);

  // Text terminal view — capture-pane output
  let terminalText = $state('');
  let terminalTextTimer: ReturnType<typeof setInterval> | null = null;

  // Chrome patterns to strip from terminal text view (same as pty-daemon fast path)
  const CHROME_RE = [
    /^─{10,}$/,                          // long dividers
    /^❯\s*$/,                            // cursor-only lines
    /^[✽✳✻✶✢·★⏺⠂⠐⠈]+(\s|$)/,            // spinner chars
    /^⏵⏵/,                               // Gemini prompt marker
    /shift\+tab|esc to interrupt|for shortcuts/i, // help text
    /^\s*[\u2800-\u28FF]+\s*$/,          // braille spinners
    /^[/\\|_`~\-.\s()*@^×]+$/,          // all-punctuation lines
    /tokens?\)|thought for \d/,          // token/thinking counters
    /^\s*[✔◼]\s+Task \d+/,              // task status markers
  ];

  function cleanTerminalText(raw: string): string {
    const lines = raw.split('\n');
    const cleaned: string[] = [];
    let consecutiveEmpty = 0;
    let lastLine = '';

    for (const line of lines) {
      const trimmed = line.trimEnd();

      // Collapse consecutive empty lines to max 1
      if (!trimmed) {
        consecutiveEmpty++;
        if (consecutiveEmpty <= 1) cleaned.push('');
        continue;
      }
      consecutiveEmpty = 0;

      // Strip chrome lines
      if (CHROME_RE.some(re => re.test(trimmed))) continue;

      // Deduplicate consecutive identical lines (idle prompts, repeated output)
      if (trimmed === lastLine) continue;

      lastLine = trimmed;
      cleaned.push(trimmed);
    }

    return cleaned.join('\n').trim();
  }

  let terminalTextLoaded = false;

  async function refreshTerminalText() {
    if (!sessionId || session?.type !== 'terminal') return;
    // Only do a full fetch once on first load — after that, WS terminal_line appends
    if (terminalTextLoaded) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/terminal/history?since=1h&limit=200`);
      if (res.ok) {
        const data = await res.json();
        const rows = data.rows || [];
        const raw = rows.map((r: any) => r.text || '').join('\n');
        terminalText = cleanTerminalText(raw) || '(no output yet)';
        terminalTextLoaded = true;
      }
    } catch {}
  }

  // Append new terminal output from WS (already cleaned/diffed by pty-daemon)
  function appendTerminalLine(text: string) {
    if (!text.trim()) return;
    const cleaned = cleanTerminalText(text);
    if (!cleaned) return;
    // Dedup against the last line of existing text
    const lastLine = terminalText.split('\n').pop()?.trim() || '';
    const firstNew = cleaned.split('\n')[0]?.trim() || '';
    if (firstNew && firstNew === lastLine) {
      const rest = cleaned.split('\n').slice(1).join('\n');
      if (rest.trim()) terminalText += '\n' + rest;
    } else {
      terminalText += '\n' + cleaned;
    }
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
  let postsFrom = $state<Record<string, unknown>[]>([]);

  async function loadMentionHandles() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/participants`);
      const data = await res.json();
      mentionHandles = (data.all || [])
        .filter((p: Record<string, string>) => p.handle)
        .map((p: Record<string, string>) => ({ handle: p.handle, name: p.name || p.handle }));
      postsFrom = data.postsFrom || [];
    } catch {}
  }

  // Linked chat state
  let linkedChatId = $state('');
  let linkedChatMessages = $state<Record<string, unknown>[]>([]);
  let linkedChatHasMore = $state(false);
  let linkedChatLoadingMore = $state(false);
  let linkedChatScrollEl = $state<HTMLElement | null>(null);
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
  const activeSearchResult = $derived(chatSearchResults[chatSearchSelectedIndex] ?? null);
  const activeSearchResultId = $derived(activeSearchResult?.id ?? null);

  async function loadLinkedChat(chatId: string) {
    if (!chatId) return;
    const res = await fetch(`/api/sessions/${chatId}/messages?limit=${LINKED_CHAT_PAGE_SIZE}`);
    const data = await res.json();
    const msgs: Record<string, unknown>[] = data.messages || [];
    linkedChatMessages = msgs;
    linkedChatHasMore = msgs.length === LINKED_CHAT_PAGE_SIZE;
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

  async function postToLinkedChat(text: string) {
    if (!linkedChatId || !text.trim()) return;
    // WS terminal_input FIRST — instant delivery to tmux (the gold standard path)
    // Two-call protocol: text first, then \r separately after 50ms delay.
    // Sending text+\r as one write fails in bracketed paste mode (Claude Code, Copilot etc.)
    if (socket?.readyState === WebSocket.OPEN) {
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
        format: 'text', sender_id: null, msg_type: 'message',
      }),
    });
    const msg = await res.json();
    if (msg.id && !linkedChatMessages.find(m => m.id === msg.id)) {
      linkedChatMessages = [...linkedChatMessages, msg];
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

  // WS
  let ws = $state<WebSocket | null>(null);
  let wsDestroyed = false;
  const socket = $derived(ws);

  function connectWs() {
    if (wsDestroyed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = new WebSocket(`${protocol}//${location.host}/ws`);
    ws = s;

    s.onopen = () => {
      // For terminal sessions, spawn the PTY (tmux session) if it doesn't exist.
      const isTerminal = session?.type === 'terminal';
      console.log(`[WS] onopen: sessionId=${sessionId} type=${session?.type} isTerminal=${isTerminal} linkedChatId=${linkedChatId}`);
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
    };

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
          case 'terminal_line':
            if (mode === 'terminal' && data.text) appendTerminalLine(data.text);
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
        }
      } catch {}
    };

    s.onclose = () => { if (!wsDestroyed) setTimeout(connectWs, 2000); };
  }

  onMount(async () => {
    const [sessRes, allSessRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}`),
      fetch('/api/sessions'),
    ]);
    session = await sessRes.json();
    allSessions = (await allSessRes.json()).sessions || [];
    mode = 'chat';
    // Terminal sessions start with the panel hidden. Chat sessions keep the
    // panel closed on narrower layouts so the conversation stays primary.
    const wideChatLayout = window.matchMedia('(min-width: 1024px)').matches;
    showPanel = session?.type !== 'terminal' && wideChatLayout;

    if (session?.type === 'terminal' && session) {
      if (session.linked_chat_id) {
        linkedChatId = session.linked_chat_id;
        await loadLinkedChat(session.linked_chat_id);
      }
    }

    if (session?.type !== 'terminal') await msgStore.load(sessionId);
    requestAnimationFrame(() => scrollToBottom());

    const [tasksRes, refsRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}/tasks`),
      fetch(`/api/sessions/${sessionId}/file-refs`),
    ]);
    tasks = (await tasksRes.json()).tasks || [];
    fileRefs = (await refsRes.json()).refs || [];
    loadMentionHandles();

    connectWs();

    // After WS connects, ensure the terminal PTY is spawned by sending
    // a second join_session with spawnPty after a short delay. The onopen
    // handler should do this but has timing issues on fresh sessions.
    if (session?.type === 'terminal') {
      setTimeout(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'join_session',
            sessionId,
            spawnPty: true,
            cols: 120,
            rows: 40,
          }));
        }
      }, 1000);
    }
    loadMemories();
  });

  $effect(() => {
    if (mode === 'terminal' && session?.type === 'terminal') {
      refreshTerminalText(); // one-time load, then WS appends
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
    if (cmdPoll !== null) clearInterval(cmdPoll);
    if (terminalTextTimer) clearInterval(terminalTextTimer);
  });

  async function sendMessage(text: string) {
    await msgStore.send(sessionId, text);
    replyTo = null;
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

  const participants = $derived.by(() => {
    const counts = new Map();
    for (const m of msgStore.messages) {
      if (!m.sender_id) continue;
      const key = allSessions.find(s => s.handle === m.sender_id)?.id ?? m.sender_id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const active = allSessions
      .filter(s => s.id !== sessionId && counts.has(s.id))
      .map(s => ({ sess: s, count: counts.get(s.id) ?? 0, active: true }));
    const available = allSessions
      .filter(s => s.id !== sessionId && !counts.has(s.id))
      .map(s => ({ sess: s, count: 0, active: false }));
    return { active, available };
  });

  // Messages to show in chat area: linked chat for terminals, msgStore for chat sessions
  const displayMessages = $derived(
    (session?.type === 'terminal' ? linkedChatMessages : msgStore.messages) as Record<string, unknown>[]
  );
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden" style="background: var(--bg); color: var(--text);">
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
  />

  <!-- Body -->
  <div class="flex flex-1 overflow-hidden min-h-0">
    <!-- Main -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      {#if mode === 'chat'}
        <ChatMessages
          messages={displayMessages}
          {sessionId}
          {session}
          {allSessions}
          {linkedChatId}
          {linkedChatHasMore}
          {linkedChatLoadingMore}
          {replyTo}
          {atBottom}
          {mentionHandles}
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
          onReply={(msg) => { replyTo = msg; }}
          onClearReply={() => (replyTo = null)}
          onAgentRespond={handleAgentRespond}
          onScrollElMounted={(el) => { chatScrollEl = el; }}
          onScroll={onChatScroll}
        />
      {:else if mode === 'terminal'}
        <!-- Text terminal mode — searchable capture-pane output -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <!-- Toolbar -->
          <div class="flex items-center px-4 py-2 border-b gap-3 flex-shrink-0" style="border-color: #E5E7EB; background: var(--bg);">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #22C55E;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
              <span class="text-xs font-semibold" style="color: var(--text);">⌨ Terminal Output</span>
            </div>
            <div class="flex-1"></div>
            <!-- Search input -->
            <div class="relative" style="width: 200px;">
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #9CA3AF;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
              </svg>
              <input
                class="w-full text-xs rounded-lg pl-8 pr-3 py-1.5 outline-none"
                style="border: 1px solid #E5E7EB; background: #F9FAFB; color: var(--text);"
                placeholder="Search output…"
              />
            </div>
            <!-- Refresh -->
            <button
              onclick={refreshTerminalText}
              class="p-1.5 rounded-lg transition-all"
              style="color: var(--text-muted); border: 1px solid #E5E7EB;"
              title="Refresh terminal output"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>
          <!-- Full-width dark content area -->
          <div class="flex-1 overflow-y-auto p-4" style="background: #0D1117;">
            <pre
              class="leading-relaxed whitespace-pre-wrap break-words"
              style="color: #C9D1D9; font-family: 'JetBrains Mono', 'Fira Mono', monospace; font-size: 12px;"
            >{terminalText || 'Loading terminal output…'}</pre>
          </div>
          <!-- Special key buttons -->
          {#await import('$lib/shared/special-keys.js') then mod}
            <div class="flex items-center gap-1 px-3 py-1.5 border-t shrink-0 overflow-x-auto scrollbar-none" style="border-color:#1E293B; background:#161B22;">
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
                  class="shrink-0 px-2.5 py-1 rounded text-[11px] font-mono transition-colors hover:bg-[#21262D]"
                  style="color:#8B949E; border:1px solid #30363D;"
                >{key.label}</button>
              {/each}
            </div>
          {/await}
          <CLIInput onSubmit={sendCommand}/>
        </div>
      {:else}
        <!-- Raw terminal mode (xterm.js) -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <div class="flex items-center px-3 py-1.5 border-b gap-2" style="border-color:var(--border-light);background:var(--bg-surface);">
            <span class="text-xs font-medium" style="color:var(--text-muted);">🖥 Raw Terminal</span>
            <div class="flex-1"></div>
            <button
              onclick={() => termKey++}
              class="p-1.5 rounded transition-all"
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
      ></div>
      <ChatSidePanel
        {session}
        {sessionId}
        {panelTab}
        {tasks}
        {fileRefs}
        {allSessions}
        {linkedChatId}
        {linkedChatMessages}
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
        onLinkedChatIdChange={(id) => (linkedChatId = id)}
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
        onCreateTask={createTask}
        onClose={() => (showPanel = false)}
      />
    {/if}
  </div>
</div>
