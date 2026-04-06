<script>
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
  import { theme } from '$lib/stores/theme.svelte';
  import { onMount, onDestroy } from 'svelte';

  const sessionId = $derived($page.params.id);
  const msgStore = useMessageStore();
  const sessionStore = useSessionStore();

  let session = $state(null);
  let allSessions = $state([]); // all sessions for participant lookup
  let mode = $state('chat');
  let signalMode = $state('xterm');
  let showMenu = $state(false);
  let showPanel = $state(false); // set after session loads
  let panelTab = $state('participants'); // 'participants' | 'tasks' | 'files'

  let tasks = $state([]);
  let fileRefs = $state([]);
  let replyTo = $state(null);
  let editingNickname = $state(null); // session ID being renamed
  let nicknameInput = $state('');

  // WS for live chat updates
  let ws = $state(null);
  let wsDestroyed = false;

  function connectWs() {
    if (wsDestroyed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    ws = socket;

    socket.onopen = () => socket.send(JSON.stringify({ type: 'join_session', sessionId }));

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.sessionId && data.sessionId !== sessionId) return;

        switch (data.type) {
          case 'message_created':
            if (!msgStore.messages.find(m => m.id === data.id)) {
              msgStore.messages = [...msgStore.messages, data];
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
            session = { ...session, handle: data.handle, display_name: data.display_name };
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
    mode = session?.type === 'terminal' ? 'terminal' : 'chat';
    // Panel open by default only for chat sessions
    showPanel = mode === 'chat';

    if (mode === 'chat') await msgStore.load(sessionId);

    const [tasksRes, refsRes] = await Promise.all([
      fetch(`/api/sessions/${sessionId}/tasks`),
      fetch(`/api/sessions/${sessionId}/file-refs`),
    ]);
    tasks = (await tasksRes.json()).tasks || [];
    fileRefs = (await refsRes.json()).refs || [];

    connectWs();
  });

  onDestroy(() => {
    wsDestroyed = true;
    ws?.close();
  });

  async function sendMessage(text) {
    await msgStore.send(sessionId, text);
    replyTo = null;
  }

  async function sendCommand(cmd) {
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
    session = { ...session, name: newName.trim() };
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
  let crossPostTarget = $state(null);
  let crossPostText = $state('');

  async function crossPost() {
    if (!crossPostTarget || !crossPostText.trim()) return;
    await fetch(`/api/sessions/${crossPostTarget}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: crossPostText.trim(),
        format: 'text',
        sender_id: sessionId,
        msg_type: 'message',
      }),
    });
    crossPostText = '';
    crossPostTarget = null;
  }

  // Nickname save
  async function saveNickname(sess) {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { editingNickname = null; return; }
    const res = await fetch(`/api/sessions/${sess.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      const updated = await res.json();
      allSessions = allSessions.map(s => s.id === updated.id ? updated : s);
    }
    editingNickname = null;
  }

  function handleColour(h) {
    const palette = ['#6366F1','#22C55E','#F59E0B','#EC4899','#26A69A','#AB47BC','#42A5F5','#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
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
          <span>{mode === 'chat' ? 'Chat' : 'Terminal'}</span>
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
          >💬</button>
          <button
            class="px-2.5 py-1 text-xs rounded transition-all"
            style={mode==='terminal' ? 'background:#22C55E;color:#fff;' : 'color:var(--text-muted);'}
            onclick={() => (mode='terminal')}
          >⌨</button>
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
        <button onclick={() => (showMenu=!showMenu)} class="p-1.5 rounded-lg" style="color:var(--text-muted);">
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
          <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {#if msgStore.messages.length === 0}
              <div class="flex flex-col items-center justify-center h-full text-center opacity-60">
                <p class="text-4xl mb-3">💬</p>
                <p class="font-medium" style="color:var(--text);">No messages yet</p>
                <p class="text-sm mt-1" style="color:var(--text-muted);">Type below, or use <code class="font-mono text-xs">ant msg</code> from a terminal</p>
              </div>
            {:else}
              {#each msgStore.messages as m (m.id)}
                <MessageBubble
                  message={m}
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
              {/each}
            {/if}
          </div>

          <MessageInput
            onSend={sendMessage}
            {replyTo}
            onClearReply={() => (replyTo = null)}
          />
        </div>
      {:else}
        <!-- Terminal mode -->
        <div class="flex flex-col flex-1 overflow-hidden">
          <div class="flex items-center gap-2 px-4 py-2 border-b" style="border-color:var(--border-light);background:var(--bg-surface);">
            <span class="text-[11px] font-medium mr-1" style="color:var(--text-faint);">VIEW</span>
            {#each ['xterm','signals','raw'] as v}
              <button
                class="px-2.5 py-1 text-xs rounded transition-all"
                style={signalMode===v ? 'background:#6366F1;color:#fff;' : 'color:var(--text-muted);'}
                onclick={() => (signalMode=v)}
              >{v.toUpperCase()}</button>
            {/each}
          </div>
          <div class="flex-1 overflow-hidden" style="background:var(--terminal-bg);">
            {#if signalMode==='xterm'}
              <Terminal {sessionId}/>
            {:else}
              <div class="flex items-center justify-center h-full text-center px-6">
                <p class="text-gray-500 text-sm">{signalMode === 'signals' ? 'Signal view — pending' : 'Raw buffer — pending'}</p>
              </div>
            {/if}
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
          {#each [['participants','👥','Participants'],['tasks','☑','Tasks'],['files','📎','Files']] as [tab, icon, label]}
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
                  <div class="rounded-lg border overflow-hidden" style="background:var(--bg-card);border-color:var(--border-subtle);">
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
                          <p class="text-sm font-semibold truncate leading-tight" style="color:{col};">{label}</p>
                          {#if p.sess.handle}
                            <p class="text-[10px] font-mono" style="color:{col}88;">{p.sess.handle}</p>
                          {/if}
                        {/if}
                      </div>
                      <div class="flex items-center gap-1 flex-shrink-0">
                        <span class="text-[10px] font-mono px-1 py-px rounded" style="background:{col}18;color:{col}99;">{p.count}</span>
                        <button
                          onclick={() => { editingNickname = p.sess.id; nicknameInput = p.sess.display_name || p.sess.name; }}
                          class="p-1 rounded transition-colors text-gray-600 hover:text-gray-300"
                          title="Rename"
                        >✎</button>
                        <button
                          onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
                          class="p-1 rounded text-xs transition-colors"
                          style={crossPostTarget === p.sess.id ? 'color:#6366F1;' : 'color:var(--text-faint);'}
                          title="Post to this session"
                        >↗</button>
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
                      <button
                        onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
                        class="p-1.5 rounded text-xs transition-colors flex-shrink-0"
                        style={crossPostTarget === p.sess.id ? 'background:#6366F122;color:#6366F1;' : 'color:var(--text-faint);'}
                        title="Post to {label}"
                      >↗</button>
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
          {:else}
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
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
