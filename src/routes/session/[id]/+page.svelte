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
  let allSessions = $state<PageSession[]>([]);
  let mode = $state('chat');
  let showMenu = $state(false);
  let showPanel = $state(true); // open by default on desktop
  let panelTab = $state('participants');

  // Hide side panel in terminal text mode (full-width dark view)
  const effectiveShowPanel = $derived(showPanel && mode !== 'terminal');

  let tasks = $state<{ id: string; status: string; [key: string]: unknown }[]>([]);
  let fileRefs = $state<{ id: string; file_path?: string; [key: string]: unknown }[]>([]);
  let replyTo = $state<Record<string, unknown> | null>(null);

  // Text terminal view — capture-pane output
  let terminalText = $state('');
  let terminalTextTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshTerminalText() {
    if (!sessionId || session?.type !== 'terminal') return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/terminal/history?since=1h&limit=500`);
      if (res.ok) {
        const data = await res.json();
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

  async function loadMentionHandles() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/participants`);
      const data = await res.json();
      mentionHandles = (data.participants || [])
        .filter((p: Record<string, string>) => p.handle)
        .map((p: Record<string, string>) => ({ handle: p.handle, name: p.name || p.handle }));
    } catch {}
  }

  // Linked chat state
  let linkedChatId = $state('');
  let linkedChatMessages = $state<Record<string, unknown>[]>([]);
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

  async function postToLinkedChat(text: string) {
    if (!linkedChatId || !text.trim()) return;
    const res = await fetch(`/api/sessions/${linkedChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user', content: text,
        format: 'text', sender_id: null, msg_type: 'message',
      }),
    });
    // Send keystrokes directly via WS FIRST (instant delivery to terminal)
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text + '\r' }));
    }
    const msg = await res.json();
    if (msg.id && !linkedChatMessages.find(m => m.id === msg.id)) {
      linkedChatMessages = [...linkedChatMessages, msg];
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
    // Terminal sessions start with panel hidden (text view is full-width); chat sessions show panel
    showPanel = session?.type !== 'terminal';

    if (session?.type === 'terminal' && session) {
      if (session.linked_chat_id) {
        linkedChatId = session.linked_chat_id;
        await loadLinkedChat(session.linked_chat_id);
      } else {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${session.name} Chat`, type: 'chat', ttl: session.ttl || '15m' }),
        });
        const newChat = await res.json();
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
    // Send keystrokes directly via WS (instant)
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text + '\r' }));
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
    onCopyTmux={() => {
      const cmd = `ssh mac.tail34caea.ts.net -t tmux attach-session -t ${sessionId}`;
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
          onSend={sendMessage}
          onPostToLinkedChat={postToLinkedChat}
          onLoadOlder={loadOlderLinkedChatMessages}
          onScrollToBottom={scrollToBottom}
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
