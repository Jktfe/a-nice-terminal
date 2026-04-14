<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useMessageStore } from '$lib/stores/messages.svelte';
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import MessageInput from '$lib/components/MessageInput.svelte';
  import CLIInput from '$lib/components/CLIInput.svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import ShareButton from '$lib/components/ShareButton.svelte';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import FileRefCard from '$lib/components/FileRefCard.svelte';
  import AgentEventCard from '$lib/components/AgentEventCard.svelte';
  import TerminalLine from '$lib/components/TerminalLine.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { useToasts } from '$lib/stores/toast.svelte';
  import { onMount, onDestroy } from 'svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string;
    ttl?: string;
    [key: string]: unknown;
  }

  const toasts = useToasts();

  const sessionId = $derived($page.params.id as string);
  const msgStore = useMessageStore();
  const sessionStore = useSessionStore();

  let session = $state<PageSession | null>(null);
  let allSessions = $state<PageSession[]>([]); // all sessions for participant lookup
  let mode = $state('chat');
  let showMenu = $state(false);
  let showPanel = $state(false); // set after session loads
  let panelTab = $state('participants'); // 'participants' | 'tasks' | 'files' | 'chat' | 'memory'

  let tasks = $state<{ id: string; status: string; [key: string]: unknown }[]>([]);
  let fileRefs = $state<{ id: string; file_path?: string; [key: string]: unknown }[]>([]);
  let replyTo = $state<Record<string, unknown> | null>(null);
  let editingNickname = $state<string | null>(null); // session ID being renamed
  let nicknameInput = $state('');

  // Text terminal view — capture-pane output
  let terminalText = $state('');
  let terminalTextTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshTerminalText() {
    if (!sessionId || session?.type !== 'terminal') return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/terminal/history?since=1h&limit=500`);
      if (res.ok) {
        const data = await res.json();
        // Join stripped text rows into a continuous transcript
        const rows = data.rows || [];
        terminalText = rows.map((r: any) => r.text || '').join('\n').trim() || '(no output yet)';
      }
    } catch {}
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
    // Lazy-load older linked chat messages when scrolled near the top
    if (linkedChatId && chatScrollEl.scrollTop < 100 && linkedChatHasMore && !linkedChatLoadingMore) {
      linkedChatScrollEl = chatScrollEl;
      loadOlderLinkedChatMessages();
    }
  }

  // Auto-scroll when new messages arrive if already at bottom
  $effect(() => {
    if (msgStore.messages.length && atBottom) {
      setTimeout(scrollToBottom, 30);
    }
  });

  // Terminal refresh — remount xterm by toggling a key
  let termKey = $state(0);

  let cmdPoll: ReturnType<typeof setInterval> | null = null;

  // Memory panel state
  let memories = $state<Record<string, unknown>[]>([]);
  let memorySearch = $state('');
  let memoryNewKey = $state('');
  let memoryNewValue = $state('');
  let memorySearchResults = $state<Record<string, unknown>[]>([]);
  let memorySearching = $state(false);

  async function loadMemories() {
    const res = await fetch('/api/memories?limit=50');
    const data = await res.json();
    memories = data.memories || [];
  }

  async function addMemory() {
    const key = memoryNewKey.trim();
    const value = memoryNewValue.trim();
    if (!key || !value) return;
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, session_id: sessionId, created_by: session?.handle || sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      memories = [data.memory, ...memories];
      memoryNewKey = '';
      memoryNewValue = '';
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

  // @ mention handles — loaded from participants API, refreshed on new messages
  let mentionHandles = $state<{ handle: string; name: string }[]>([]);

  async function loadMentionHandles() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/participants`);
      const data = await res.json();
      mentionHandles = (data.participants || [])
        .filter((p: Record<string, string>) => p.handle)
        .map((p: Record<string, string>) => ({ handle: p.handle, name: p.name || p.handle }));
    } catch {}
  }

  // Chat feed (for terminal sessions — link to a chat session and follow it)
  let linkedChatId = $state('');
  let linkedChatMessages = $state<Record<string, unknown>[]>([]);
  let linkedChatInput = $state('');
  let linkedChatHasMore = $state(false);
  let linkedChatLoadingMore = $state(false);
  let linkedChatScrollEl = $state<HTMLElement | null>(null);
  const LINKED_CHAT_PAGE_SIZE = 50;

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

  function onLinkedChatScroll() {
    if (!linkedChatScrollEl || !linkedChatHasMore || linkedChatLoadingMore) return;
    if (linkedChatScrollEl.scrollTop < 100) loadOlderLinkedChatMessages();
  }

  async function postToLinkedChat() {
    if (!linkedChatId || !linkedChatInput.trim()) return;
    const text = linkedChatInput.trim();
    linkedChatInput = '';
    const res = await fetch(`/api/sessions/${linkedChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user', content: text,
        format: 'text', sender_id: sessionId, msg_type: 'message',
      }),
    });
    const msg = await res.json();
    // Optimistic append — WS message_created handler deduplicates by id
    if (msg.id && !linkedChatMessages.find(m => m.id === msg.id)) {
      linkedChatMessages = [...linkedChatMessages, msg];
    }
    // Also inject into the terminal PTY — the CLI LLM running there sees it as stdin
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text + '\r' }));
    }
  }

  // Wake a participant — send a targeted message from the current session to their handle
  // This triggers PTY injection on the server, so the AI in their terminal sees it
  async function wakeParticipant(targetSess: PageSession) {
    const handle = targetSess.handle;
    const chatSessions = allSessions.filter(s => s.type === 'chat');
    const chatRef = chatSessions.length > 0 ? chatSessions[0] : null;
    const myName = session?.name || sessionId;
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

  // WS for live chat updates
  let ws = $state<WebSocket | null>(null);
  let wsDestroyed = false;

  function connectWs() {
    if (wsDestroyed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    ws = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join_session', sessionId }));
      // Also subscribe to linked chat session events
      if (linkedChatId && linkedChatId !== sessionId) {
        socket.send(JSON.stringify({ type: 'join_session', sessionId: linkedChatId }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Route linked chat events — handle and return early to avoid falling through to main session logic
        if (linkedChatId && data.sessionId === linkedChatId) {
          if (data.type === 'message_created') {
            if (!linkedChatMessages.find(m => m.id === data.id)) {
              linkedChatMessages = [...linkedChatMessages, data];
              // Auto-scroll to bottom when new message arrives
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
              // New sender may not be in mention list yet — refresh handles
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
        }
      } catch {}
    };

    socket.onclose = () => { if (!wsDestroyed) setTimeout(connectWs, 2000); };
  }

  onMount(async () => {
    const [sessRes, allSessRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}`),
      fetch('/api/sessions'),
    ]);
    session = await sessRes.json();
    allSessions = (await allSessRes.json()).sessions || [];
    // Terminal sessions with a linked chat default to chat view; raw terminal is opt-in.
    // If there's no linked_chat_id yet it will be auto-created below, so still default chat.
    mode = 'chat';
    // Panel open by default only for chat sessions
    showPanel = session?.type !== 'terminal';

    // Per-terminal dedicated chat — persist the link so each terminal always has its own chat
    if (session?.type === 'terminal' && session) {
      if (session.linked_chat_id) {
        linkedChatId = session.linked_chat_id;
        await loadLinkedChat(session.linked_chat_id);
      } else {
        // Auto-create a dedicated chat session for this terminal
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${session.name} Chat`, type: 'chat', ttl: session.ttl || '15m' }),
        });
        const newChat = await res.json();
        // Persist the link so the next open finds the same chat
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linked_chat_id: newChat.id }),
        });
        linkedChatId = newChat.id;
        allSessions = [...allSessions, newChat];
        await loadLinkedChat(newChat.id);
      }
    }

    if (session?.type !== 'terminal') await msgStore.load(sessionId);

    // Scroll chat to bottom after initial load
    requestAnimationFrame(() => scrollToBottom());

    const [tasksRes, refsRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}/tasks`),
      fetch(`/api/sessions/${sessionId}/file-refs`),
    ]);
    tasks = (await tasksRes.json()).tasks || [];
    fileRefs = (await refsRes.json()).refs || [];
    loadMentionHandles();

    connectWs();
    loadMemories();

  });

  // Auto-refresh terminal text view when that tab is active
  $effect(() => {
    if (mode === 'terminal' && session?.type === 'terminal') {
      refreshTerminalText();
      terminalTextTimer = setInterval(refreshTerminalText, 2000);
    } else {
      if (terminalTextTimer) { clearInterval(terminalTextTimer); terminalTextTimer = null; }
    }
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
    await fetch(`/api/sessions/${sessionId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: text }),
    });
    await new Promise(r => setTimeout(r, 5));
    await fetch(`/api/sessions/${sessionId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '\r' }),
    });
  }

  async function copySessionId() {
    await navigator.clipboard.writeText(sessionId);
    showMenu = false;
  }

  async function renameSession() {
    const newName = prompt('New session name:', session?.name || '');
    if (!newName?.trim()) return;
    showMenu = false;
    await sessionStore.renameSession(sessionId, newName.trim());
    session = { ...session!, name: newName.trim() };
  }

  async function deleteSession() {
    if (!confirm(`Delete session "${session?.name}"? This cannot be undone.`)) return;
    showMenu = false;
    await sessionStore.deleteSession(sessionId);
    goto('/');
  }

  let newTaskTitle = $state('');
  let showNewTaskInput = $state(false);

  async function createTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    const res = await fetch(`/api/sessions/${sessionId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, created_by: sessionId }),
    });
    const data = await res.json();
    if (data.task && !tasks.find(t => t.id === data.task.id)) tasks = [...tasks, data.task];
    newTaskTitle = '';
    showNewTaskInput = false;
  }

  // All sessions split into: active in this session vs. others available
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

  // Cross-session quick post
  let crossPostTarget = $state<string | null>(null);
  let crossPostText = $state('');

  async function crossPost() {
    if (!crossPostTarget || !crossPostText.trim()) return;
    const targetSess = allSessions.find(s => s.id === crossPostTarget);
    // Post to the CURRENT session with target handle — triggers PTY injection
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: crossPostText.trim(),
        format: 'text',
        sender_id: sessionId,
        target: targetSess?.handle || null,
        msg_type: 'message',
      }),
    });
    const msg = await res.json();
    // Optimistic append — WS message_created handler deduplicates by id
    if (msg.id && !msgStore.messages.find(m => m.id === msg.id)) {
      msgStore.messages = [...msgStore.messages, msg];
    }
    const name = targetSess?.display_name || targetSess?.name || 'session';
    crossPostText = '';
    crossPostTarget = null;
    toasts.show(`Posted to ${name}`);
  }

  // Nickname save
  async function saveNickname(sess: PageSession) {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { editingNickname = null; return; }
    // Update the handle (auto-prefix @)
    const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    const res = await fetch(`/api/sessions/${sess.id}/handle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    });
    if (res.ok) {
      const updated = await res.json();
      allSessions = allSessions.map(s => s.id === sess.id ? { ...s, handle: updated.handle } : s);
    }
    editingNickname = null;
  }

  function handleColour(h: string) {
    const palette = ['#6366F1','#22C55E','#F59E0B','#EC4899','#26A69A','#AB47BC','#42A5F5','#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
  }

  // Group consecutive terminal_line messages into single blocks for compact rendering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function groupMessages(msgs: any[]): { key: string; type: string; items: any[] }[] {
    const groups: { key: string; type: string; items: any[] }[] = [];
    for (const msg of msgs) {
      const t = (msg.msg_type as string) || 'chat';
      if (t === 'terminal_line' && groups.length > 0 && groups[groups.length - 1].type === 'terminal_line') {
        groups[groups.length - 1].items.push(msg);
      } else {
        groups.push({ key: msg.id as string, type: t, items: [msg] });
      }
    }
    return groups;
  }

  const activeTasks = $derived(tasks.filter(t => t.status !== 'deleted'));
  const openTaskCount = $derived(activeTasks.filter(t => !['complete'].includes(t.status)).length);

  // Bookmarked messages shown in Files tab as refs
  const bookmarkedMessages = $derived(
    msgStore.messages.filter(m => {
      try { return JSON.parse(m.meta || '{}').bookmarked; } catch { return false; }
    })
  );
  const allFiles = $derived([
    ...fileRefs.filter(r => !r.file_path?.startsWith('msg:')),
    ...fileRefs.filter(r => r.file_path?.startsWith('msg:')),
  ]);
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden" style="background: var(--bg); color: var(--text);">
  <!-- Toolbar -->
  <div class="flex items-center justify-between px-4 py-2.5 h-14 border-b flex-shrink-0"
       style="border-color: var(--border-light); background: var(--bg);">
    <button
      onclick={() => goto('/')}
      class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all text-sm"
      style="color: var(--text-muted);"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
      </svg>
      Back
    </button>

    <div class="flex-1 flex items-center justify-center min-w-0 px-3">
      <div class="text-center min-w-0">
        <h1 class="text-base font-semibold truncate leading-tight">{session?.name || 'Session'}</h1>
        <p class="text-[11px] leading-tight" style="color: var(--text-muted);">
          {#if session?.handle}
            <span class="font-mono" style="color:#22C55E;">{session.handle}</span>
            <span class="mx-1 opacity-40">·</span>
          {/if}
          <span>{mode === 'chat' ? 'Chat' : mode === 'terminal' ? 'Terminal' : 'Raw'}</span>
        </p>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      <button onclick={() => theme.toggle()} class="p-1.5 rounded-lg transition-all" style="color:var(--text-muted);" title="Toggle theme">
        {#if theme.dark}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>
          </svg>
        {:else}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        {/if}
      </button>

      <!-- Mode toggle — only shown for terminal sessions (chat sessions have no PTY) -->
      {#if session?.type === 'terminal'}
        <div class="flex rounded-lg p-0.5 border" style="background:var(--bg-card);border-color:var(--border-subtle);">
          <button
            class="px-2.5 py-1 text-xs rounded transition-all"
            style={mode==='chat' ? 'background:#6366F1;color:#fff;' : 'color:var(--text-muted);'}
            onclick={() => (mode='chat')}
            title="Chat — interactions & events"
          >💬</button>
          <button
            class="px-2.5 py-1 text-xs rounded transition-all"
            style={mode==='terminal' ? 'background:#22C55E;color:#fff;' : 'color:var(--text-muted);'}
            onclick={() => (mode='terminal')}
            title="Terminal — text output"
          >⌨</button>
          <button
            class="px-2.5 py-1 text-xs rounded transition-all"
            style={mode==='raw' ? 'background:#F59E0B;color:#fff;' : 'color:var(--text-muted);'}
            onclick={() => (mode='raw')}
            title="Raw — xterm.js"
          >🖥</button>
        </div>
      {/if}

      <!-- Panel toggle with badge -->
      <button
        onclick={() => (showPanel = !showPanel)}
        class="relative px-2.5 py-1 text-xs rounded-lg border transition-all"
        style={showPanel
          ? 'background:#6366F122;border-color:#6366F1;color:#6366F1;'
          : 'border-color:var(--border-subtle);color:var(--text-muted);'}
        title="Participants, Tasks & Files"
      >
        ☰ Panel
        {#if openTaskCount > 0}
          <span class="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-[#6366F1] text-white">{openTaskCount}</span>
        {/if}
      </button>

      {#if session}
        <ShareButton {sessionId} sessionType={session.type} />
      {/if}

      <!-- Menu -->
      <div class="relative">
        <button onclick={() => (showMenu=!showMenu)} class="p-1.5 rounded-lg" style="color:var(--text-muted);" aria-label="Session menu">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
          </svg>
        </button>
        {#if showMenu}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={() => (showMenu=false)}></div>
          <div class="absolute right-0 mt-1 w-44 rounded-lg border shadow-xl z-50 overflow-hidden text-sm"
               style="background:var(--bg-card);border-color:var(--border-light);">
            <button onclick={copySessionId} class="w-full text-left px-3 py-2 border-b transition-colors" style="color:var(--text-muted);border-color:var(--border-subtle);">📋 Copy ID</button>
            <button onclick={renameSession} class="w-full text-left px-3 py-2 border-b transition-colors" style="color:var(--text-muted);border-color:var(--border-subtle);">✏️ Rename</button>
            <button onclick={deleteSession} class="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 transition-colors">🗑 Delete</button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Body -->
  <div class="flex flex-1 overflow-hidden min-h-0">
    <!-- Main -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      {#if mode === 'chat'}
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- Messages -->
          <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative"
               bind:this={chatScrollEl}
               onscroll={onChatScroll}>
            {#if session?.type === 'terminal'}
              {#if linkedChatMessages.length === 0}
                <div class="flex flex-col items-center justify-center h-full text-center opacity-60">
                  <p class="text-4xl mb-3">💬</p>
                  <p class="font-medium" style="color:var(--text);">No messages in linked chat</p>
                </div>
              {:else}
                {#if linkedChatLoadingMore}
                  <div class="flex justify-center py-2 text-xs" style="color:var(--text-muted);">Loading older messages…</div>
                {:else if linkedChatHasMore}
                  <div class="flex justify-center py-1">
                    <button
                      onclick={loadOlderLinkedChatMessages}
                      class="text-xs px-3 py-1 rounded-full border transition-all"
                      style="border-color:var(--border-subtle);color:var(--text-muted);"
                    >Load older messages</button>
                  </div>
                {/if}
                {#each groupMessages(linkedChatMessages) as group (group.key)}
                  {#if group.type === 'terminal_line'}
                    <TerminalLine messages={group.items} />
                  {:else if group.type === 'agent_event'}
                    <AgentEventCard
                      message={group.items[0]}
                      sessionId={linkedChatId}
                      onRespond={async (payload) => {
                        await fetch(`/api/sessions/${linkedChatId}/messages`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            role: 'user',
                            msg_type: 'agent_response',
                            content: JSON.stringify(payload),
                          }),
                        });
                      }}
                    />
                  {:else}
                    <MessageBubble
                      message={group.items[0]}
                      {sessionId}
                      {allSessions}
                      onReply={(msg) => { replyTo = msg; }}
                      onDeleted={(id) => { linkedChatMessages = linkedChatMessages.filter(x => x.id !== id); }}
                      onMetaUpdated={(id, meta) => {
                        linkedChatMessages = linkedChatMessages.map(x =>
                          x.id === id ? { ...x, meta: JSON.stringify(meta) } : x
                        );
                      }}
                    />
                  {/if}
                {/each}
              {/if}
            {:else}
              {#if msgStore.messages.length === 0}
                <div class="flex flex-col items-center justify-center h-full text-center opacity-60">
                  <p class="text-4xl mb-3">💬</p>
                  <p class="font-medium" style="color:var(--text);">No messages yet</p>
                  <p class="text-sm mt-1" style="color:var(--text-muted);">Type below, or use <code class="font-mono text-xs">ant msg</code> from a terminal</p>
                </div>
              {:else}
                {#each groupMessages(msgStore.messages) as group (group.key)}
                  {#if group.type === 'terminal_line'}
                    <TerminalLine messages={group.items} />
                  {:else}
                    <MessageBubble
                      message={group.items[0]}
                      {sessionId}
                      {allSessions}
                      onReply={(msg) => { replyTo = msg; }}
                      onDeleted={(id) => { msgStore.messages = msgStore.messages.filter(x => x.id !== id); }}
                      onMetaUpdated={(id, meta) => {
                        msgStore.messages = msgStore.messages.map(x =>
                          x.id === id ? { ...x, meta: JSON.stringify(meta) } : x
                        );
                      }}
                    />
                  {/if}
                {/each}
              {/if}
            {/if}
          </div>

          <!-- Scroll-to-bottom button -->
          {#if !atBottom}
            <div class="flex justify-center py-1">
              <button
                onclick={scrollToBottom}
                class="flex items-center gap-1.5 px-3 py-1 text-xs rounded-full shadow-lg border transition-all"
                style="background:var(--bg-card);border-color:#6366F155;color:#6366F1;"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                </svg>
                Jump to bottom
              </button>
            </div>
          {/if}

          {#if session?.type === 'terminal'}
            <div class="flex gap-2 p-3 border-t" style="border-color:var(--border-light);">
              <input
                class="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                style="background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text);"
                placeholder="Message linked chat…"
                bind:value={linkedChatInput}
                onkeydown={(e) => { if (e.key === 'Enter') postToLinkedChat(); }}
              />
              <button
                onclick={postToLinkedChat}
                class="px-3 py-2 text-sm rounded-lg font-medium"
                style="background:#6366F1;color:#fff;"
              >Send</button>
            </div>
          {:else}
            <MessageInput
              onSend={sendMessage}
              {replyTo}
              onClearReply={() => (replyTo = null)}
              handles={mentionHandles}
            />
          {/if}
        </div>
      {:else if mode === 'terminal'}
        <!-- Text terminal mode — searchable capture-pane output -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <div class="flex items-center px-3 py-1.5 border-b gap-2" style="border-color:var(--border-light);background:var(--bg-surface);">
            <span class="text-xs font-medium" style="color:var(--text-muted);">⌨ Terminal Output</span>
            <div class="flex-1"></div>
            <button
              onclick={refreshTerminalText}
              class="p-1.5 rounded transition-all"
              style="color:var(--text-faint);"
              title="Refresh"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-4" style="background:#0D1117;">
            <pre class="text-xs leading-relaxed whitespace-pre-wrap break-words" style="color:#E6EDF3;font-family:'JetBrains Mono',monospace;">{terminalText || 'Loading terminal output…'}</pre>
          </div>
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

    <!-- Side panel -->
    {#if showPanel}
      <div class="w-64 flex-shrink-0 flex flex-col border-l overflow-hidden"
           style="border-color:var(--border-light);background:var(--bg-surface);">
        <!-- Tab bar -->
        <div class="flex border-b flex-shrink-0" style="border-color:var(--border-subtle);">
          {#each [
            ['participants','👥','Participants'],
            ['tasks','☑','Tasks'],
            ['files','📎','Files'],
            ...(session?.type === 'terminal' ? [['chat','💬','Chat']] : []),
            ['memory','🧠','Memory'],
          ] as [tab, icon, label]}
            <button
              onclick={() => (panelTab=tab)}
              class="flex-1 py-2 text-xs font-medium transition-all border-b-2 relative"
              style={panelTab===tab
                ? 'border-color:#6366F1;color:#6366F1;'
                : 'border-color:transparent;color:var(--text-faint);'}
            >
              {icon} {label}
              {#if tab==='tasks' && openTaskCount > 0}
                <span class="absolute top-1 right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center bg-[#6366F1] text-white">{openTaskCount}</span>
              {/if}
            </button>
          {/each}
        </div>

        <!-- Panel content -->
        <div class="flex-1 overflow-y-auto min-h-0">

          <!-- PARTICIPANTS TAB -->
          {#if panelTab === 'participants'}
            <div class="p-3 space-y-2">

              <!-- This session's own identity — always first -->
              {#if session}
                {@const col = handleColour(session.id)}
                <div class="rounded-lg border p-2 flex items-center gap-2.5"
                     style="background:var(--bg-card);border-color:{col}55;">
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                       style="background:{col};">
                    {(session.display_name || session.name).slice(0,2).toUpperCase()}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1">
                      <p class="text-sm font-semibold truncate" style="color:{col};">{session.display_name || session.name}</p>
                      <span class="text-[9px] px-1 py-px rounded font-medium" style="background:{col}22;color:{col};">you</span>
                    </div>
                    {#if session.handle}
                      <p class="text-[10px] font-mono" style="color:{col}88;">{session.handle}</p>
                    {/if}
                    <p class="text-[9px] font-mono" style="color:var(--text-faint);">{session.type} · {session.id.slice(0,8)}…</p>
                  </div>
                </div>
              {/if}

              <!-- Active participants (have posted in this session) -->
              {#if participants.active.length > 0}
                <p class="text-[10px] font-semibold uppercase tracking-wide pt-1" style="color:var(--text-faint);">Active here</p>
                {#each participants.active as p}
                  {@const col = handleColour(p.sess.id)}
                  {@const label = p.sess.display_name || p.sess.name}
                  <div class="group/pcard rounded-lg border overflow-hidden" style="background:var(--bg-card);border-color:var(--border-subtle);">
                    <div class="flex items-center gap-2.5 p-2">
                      <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 relative"
                           style="background:{col};">
                        {label.slice(0,2).toUpperCase()}
                        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border border-[#0D0D12]"></span>
                      </div>
                      <div class="min-w-0 flex-1">
                        {#if editingNickname === p.sess.id}
                          <input
                            class="w-full text-sm rounded px-1.5 py-0.5 outline-none"
                            style="background:var(--bg);border:1px solid #6366F1;color:var(--text);"
                            bind:value={nicknameInput}
                            onkeydown={(e) => {
                              if (e.key === 'Enter') saveNickname(p.sess);
                              if (e.key === 'Escape') editingNickname = null;
                            }}
                            onblur={() => saveNickname(p.sess)}
                          />
                        {:else}
                          <div class="flex items-center gap-1 min-w-0">
                            <p class="text-sm font-semibold truncate leading-tight" style="color:{col};">{label}</p>
                            <span class="text-[10px] font-mono px-1 py-px rounded flex-shrink-0" style="background:{col}18;color:{col}99;">{p.count}</span>
                          </div>
                          {#if p.sess.handle}
                            <p class="text-[10px] font-mono" style="color:{col}88;">{p.sess.handle}</p>
                          {/if}
                        {/if}
                      </div>
                      <div class="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onclick={() => { editingNickname = p.sess.id; nicknameInput = p.sess.handle || ''; }}
                          class="p-1 rounded transition-all text-gray-700 hover:text-gray-300 opacity-0 group-hover/pcard:opacity-100"
                          title="Set handle (e.g. @gemini)"
                        >✎</button>
                        <button
                          onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
                          class="p-1 rounded text-xs transition-colors"
                          style={crossPostTarget === p.sess.id ? 'color:#6366F1;' : 'color:var(--text-faint);'}
                          title="Post to this session"
                        >↗</button>
                        {#if p.sess.type === 'terminal' && p.sess.handle}
                          <button
                            onclick={() => wakeParticipant(p.sess)}
                            class="p-1 rounded text-xs transition-colors"
                            style="color:var(--text-faint);"
                            title="Wake — send a notification to this terminal's AI"
                          >📢</button>
                        {/if}
                      </div>
                    </div>
                    <div class="px-2 pb-1.5 flex items-center gap-1.5">
                      <span class="text-[9px] font-mono px-1 py-px rounded" style="background:{col}18;color:{col}88;">{p.sess.type}</span>
                      <span class="text-[9px] font-mono" style="color:var(--text-faint);">{p.sess.id.slice(0,8)}…</span>
                    </div>
                    <!-- Cross-post inline input -->
                    {#if crossPostTarget === p.sess.id}
                      <div class="px-2 pb-2">
                        <div class="flex gap-1">
                          <input
                            class="flex-1 text-xs rounded px-2 py-1 outline-none"
                            style="background:var(--bg);border:1px solid #6366F1;color:var(--text);"
                            placeholder="Post to {label}…"
                            bind:value={crossPostText}
                            onkeydown={(e) => { if (e.key === 'Enter') crossPost(); if (e.key === 'Escape') crossPostTarget = null; }}
                          />
                          <button onclick={crossPost} class="px-2 py-1 text-xs rounded font-medium" style="background:#6366F1;color:#fff;">↗</button>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              {/if}

              <!-- All other sessions (available, not yet active here) -->
              {#if participants.available.length > 0}
                <p class="text-[10px] font-semibold uppercase tracking-wide pt-1" style="color:var(--text-faint);">All sessions</p>
                {#each participants.available as p}
                  {@const col = handleColour(p.sess.id)}
                  {@const label = p.sess.display_name || p.sess.name}
                  <div class="rounded-lg border overflow-hidden" style="background:var(--bg-card);border-color:var(--border-subtle);opacity:0.7;">
                    <div class="flex items-center gap-2.5 p-2">
                      <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                           style="background:{col}55;">
                        {label.slice(0,2).toUpperCase()}
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-xs font-medium truncate" style="color:{col}88;">{label}</p>
                        <p class="text-[9px] font-mono" style="color:var(--text-faint);">{p.sess.type} · {p.sess.id.slice(0,8)}…</p>
                      </div>
                      <div class="flex items-center gap-1 flex-shrink-0">
                        <button
                          onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
                          class="p-1.5 rounded text-xs transition-colors"
                          style={crossPostTarget === p.sess.id ? 'background:#6366F122;color:#6366F1;' : 'color:var(--text-faint);'}
                          title="Post to {label}"
                        >↗</button>
                        {#if p.sess.type === 'terminal' && p.sess.handle}
                          <button
                            onclick={() => wakeParticipant(p.sess)}
                            class="p-1.5 rounded text-xs transition-colors"
                            style="color:var(--text-faint);"
                            title="Wake — notify this terminal's AI"
                          >📢</button>
                        {/if}
                      </div>
                    </div>
                    <!-- Cross-post inline input -->
                    {#if crossPostTarget === p.sess.id}
                      <div class="px-2 pb-2">
                        <div class="flex gap-1">
                          <input
                            class="flex-1 text-xs rounded px-2 py-1 outline-none"
                            style="background:var(--bg);border:1px solid #6366F1;color:var(--text);"
                            placeholder="Post to {label}…"
                            bind:value={crossPostText}
                            onkeydown={(e) => { if (e.key === 'Enter') crossPost(); if (e.key === 'Escape') crossPostTarget = null; }}
                          />
                          <button onclick={crossPost} class="px-2 py-1 text-xs rounded font-medium" style="background:#6366F1;color:#fff;">↗</button>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              {/if}

              {#if participants.active.length === 0 && participants.available.length === 0}
                <p class="text-xs text-center py-4" style="color:var(--text-faint);">No other sessions</p>
              {/if}
            </div>

          <!-- TASKS TAB -->
          {:else if panelTab==='tasks'}
            <div class="p-2 space-y-1.5">
              {#if showNewTaskInput}
                <div class="flex gap-1">
                  <input
                    class="flex-1 text-xs rounded px-2 py-1.5 outline-none"
                    style="background:var(--bg);border:1px solid #6366F1;color:var(--text);"
                    placeholder="Task title…"
                    bind:value={newTaskTitle}
                    onkeydown={(e) => { if (e.key === 'Enter') createTask(); if (e.key === 'Escape') { showNewTaskInput = false; newTaskTitle = ''; } }}
                  />
                  <button onclick={createTask} disabled={!newTaskTitle.trim()} class="px-2 text-xs rounded font-medium disabled:opacity-40" style="background:#6366F1;color:#fff;">+</button>
                  <button onclick={() => { showNewTaskInput = false; newTaskTitle = ''; }} class="px-2 text-xs rounded" style="color:var(--text-faint);">✕</button>
                </div>
              {:else}
                <button
                  onclick={() => { showNewTaskInput = true; }}
                  class="w-full py-1.5 text-xs rounded-lg border border-dashed transition-all text-center"
                  style="border-color:var(--border-subtle);color:var(--text-faint);"
                >+ New task</button>
              {/if}
              {#if activeTasks.length === 0}
                <div class="text-center py-8 opacity-50">
                  <p class="text-2xl mb-2">☑</p>
                  <p class="text-xs" style="color:var(--text-muted);">No tasks yet</p>
                  <p class="text-[11px] mt-1" style="color:var(--text-faint);">Use <code class="font-mono">ant task &lt;id&gt; create</code></p>
                </div>
              {:else}
                {#each activeTasks as t (t.id)}
                  <TaskCard
                    task={t}
                    {sessionId}
                    {allSessions}
                    onUpdated={(u) => { tasks = tasks.map(x => x.id === u.id ? u : x); }}
                  />
                {/each}
              {/if}
            </div>

          <!-- FILES TAB -->
          {:else if panelTab === 'files'}
            <div class="p-2 space-y-1">
              {#if allFiles.length === 0 && bookmarkedMessages.length === 0}
                <div class="text-center py-8 opacity-50">
                  <p class="text-2xl mb-2">📎</p>
                  <p class="text-xs" style="color:var(--text-muted);">No flagged files</p>
                  <p class="text-[11px] mt-1" style="color:var(--text-faint);">Use 🔖 on a message or <code class="font-mono">ant flag</code></p>
                </div>
              {:else}
                <!-- Real file refs (non-message bookmarks) -->
                {#each fileRefs.filter(r => !r.file_path?.startsWith('msg:')) as r (r.id)}
                  <FileRefCard
                    ref={r}
                    {sessionId}
                    onRemoved={(id) => { fileRefs = fileRefs.filter(x => x.id !== id); }}
                  />
                {/each}

                <!-- Bookmarked messages -->
                {#if bookmarkedMessages.length > 0}
                  <p class="text-[10px] font-semibold uppercase tracking-wide mt-3 mb-1 px-1" style="color:var(--text-faint);">Bookmarked messages</p>
                  {#each bookmarkedMessages as m (m.id)}
                    <div class="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs group"
                         style="background:var(--bg-card);border-color:var(--border-subtle);">
                      <span class="text-yellow-400 mt-0.5 flex-shrink-0">🔖</span>
                      <div class="flex-1 min-w-0">
                        {#if m.sender_id}
                          <p class="font-mono text-[10px] mb-0.5" style="color:{handleColour(m.sender_id)};">{m.sender_id}</p>
                        {/if}
                        <p class="text-gray-300 truncate">{m.content.slice(0,80)}</p>
                      </div>
                    </div>
                  {/each}
                {/if}
              {/if}
            </div>

          <!-- CHAT FEED TAB (terminals only — follow a chat session) -->
          {:else if panelTab === 'chat'}
            <div class="flex flex-col h-full">
              <!-- Session selector -->
              <div class="px-3 pt-2.5 pb-2 border-b flex-shrink-0" style="border-color:var(--border-subtle);">
                <select
                  bind:value={linkedChatId}
                  onchange={() => loadLinkedChat(linkedChatId)}
                  class="w-full text-xs rounded px-2 py-1.5 outline-none"
                  style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
                >
                  <option value="">— pick chat session —</option>
                  {#each allSessions.filter(s => s.type === 'chat') as s}
                    <option value={s.id}>{s.display_name || s.name}</option>
                  {/each}
                </select>
              </div>

              <!-- Message feed -->
              <div class="flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-1.5">
                {#if !linkedChatId}
                  <p class="text-center text-xs py-8" style="color:var(--text-faint);">Select a chat to follow</p>
                {:else if linkedChatMessages.length === 0}
                  <p class="text-center text-xs py-8" style="color:var(--text-faint);">No messages yet</p>
                {:else}
                  {#each groupMessages(linkedChatMessages) as group (group.key)}
                    {#if group.type === 'terminal_line'}
                      <TerminalLine messages={group.items} />
                    {:else if group.type === 'agent_event'}
                      <AgentEventCard
                        message={group.items[0]}
                        sessionId={linkedChatId}
                        onRespond={async (payload) => {
                          await fetch(`/api/sessions/${linkedChatId}/messages`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              role: 'user',
                              msg_type: 'agent_response',
                              content: JSON.stringify(payload),
                            }),
                          });
                        }}
                      />
                    {:else}
                      {@const m = group.items[0]}
                      {@const senderSess = allSessions.find(s => s.id === m.sender_id || s.handle === m.sender_id)}
                      {@const senderName = senderSess ? (senderSess.display_name || senderSess.name) : (m.sender_id || (m.role === 'user' ? 'You' : 'AI'))}
                      {@const col = m.sender_id ? handleColour(m.sender_id as string) : (m.role === 'user' ? '#4B5563' : '#6366F1')}
                      <div class="text-xs rounded-lg border px-2.5 py-2" style="background:var(--bg-card);border-color:{col}22;border-left:2px solid {col};">
                        <p class="font-semibold mb-0.5 font-mono text-[10px]" style="color:{col};">{senderName}</p>
                        <p class="text-gray-300 break-words line-clamp-4">{m.content}</p>
                      </div>
                    {/if}
                  {/each}
                {/if}
              </div>

              <!-- Quick reply input -->
              {#if linkedChatId}
                <div class="px-2 pb-2 pt-1 border-t flex-shrink-0" style="border-color:var(--border-subtle);">
                  <div class="flex gap-1">
                    <input
                      class="flex-1 text-xs rounded px-2 py-1.5 outline-none"
                      style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
                      placeholder="Post to chat…"
                      bind:value={linkedChatInput}
                      onkeydown={(e) => { if (e.key === 'Enter') postToLinkedChat(); }}
                    />
                    <button onclick={postToLinkedChat} disabled={!linkedChatInput.trim()}
                      class="px-2 text-xs rounded font-medium disabled:opacity-40"
                      style="background:#6366F1;color:#fff;">↗</button>
                  </div>
                </div>
              {/if}
            </div>

          <!-- MEMORY TAB -->
          {:else if panelTab === 'memory'}
            <div class="flex flex-col h-full">
              <!-- Search bar -->
              <div class="px-3 pt-2.5 pb-2 border-b flex-shrink-0" style="border-color:var(--border-subtle);">
                <input
                  bind:value={memorySearch}
                  placeholder="Search memory…"
                  class="w-full text-xs rounded px-2.5 py-1.5 outline-none"
                  style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
                />
              </div>

              <!-- Add new -->
              <div class="px-3 py-2 border-b flex-shrink-0 space-y-1.5" style="border-color:var(--border-subtle);">
                <input
                  bind:value={memoryNewKey}
                  placeholder="Key (e.g. project-goal)"
                  class="w-full text-xs rounded px-2 py-1 outline-none"
                  style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
                  onkeydown={(e) => { if (e.key === 'Enter') addMemory(); }}
                />
                <div class="flex gap-1">
                  <input
                    bind:value={memoryNewValue}
                    placeholder="Value…"
                    class="flex-1 text-xs rounded px-2 py-1 outline-none"
                    style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
                    onkeydown={(e) => { if (e.key === 'Enter') addMemory(); }}
                  />
                  <button onclick={addMemory} disabled={!memoryNewKey.trim() || !memoryNewValue.trim()}
                    class="px-2 text-xs rounded font-medium disabled:opacity-40"
                    style="background:#6366F1;color:#fff;">Save</button>
                </div>
              </div>

              <!-- List / results -->
              <div class="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
                {#if memorySearching}
                  <p class="text-center text-xs py-4" style="color:var(--text-faint);">Searching…</p>
                {:else if (memorySearch.trim() ? memorySearchResults : memories).length === 0}
                  <div class="text-center py-8 opacity-50">
                    <p class="text-2xl mb-2">🧠</p>
                    <p class="text-xs" style="color:var(--text-muted);">{memorySearch ? 'No results' : 'No memories yet'}</p>
                  </div>
                {:else}
                  {#each (memorySearch.trim() ? memorySearchResults : memories) as mem (mem.id)}
                    <div class="rounded-lg border px-2.5 py-2 group/mem text-xs"
                         style="background:var(--bg-card);border-color:var(--border-subtle);">
                      <div class="flex items-start justify-between gap-1">
                        <p class="font-mono font-semibold text-[11px] truncate flex-1" style="color:#6366F1;">{mem.key}</p>
                        <button
                          onclick={() => deleteMemory(mem.id)}
                          class="opacity-0 group-hover/mem:opacity-100 text-gray-600 hover:text-red-400 transition-all flex-shrink-0 text-[10px]"
                        >✕</button>
                      </div>
                      {#if mem.snippet}
                        <p class="text-gray-400 mt-0.5 break-words line-clamp-3">{@html mem.snippet}</p>
                      {:else}
                        <p class="text-gray-400 mt-0.5 break-words line-clamp-3">{mem.value}</p>
                      {/if}
                      {#if mem.created_by}
                        <p class="text-[10px] mt-1 font-mono" style="color:var(--text-faint);">{mem.created_by}</p>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
