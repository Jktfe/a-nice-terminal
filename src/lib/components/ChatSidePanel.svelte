<script lang="ts">
  import TaskCard from '$lib/components/TaskCard.svelte';
  import FileRefCard from '$lib/components/FileRefCard.svelte';
  import AgentEventCard from '$lib/components/AgentEventCard.svelte';
  import TerminalLine from '$lib/components/TerminalLine.svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    [key: string]: unknown;
  }

  interface Props {
    session: PageSession | null;
    sessionId: string;
    panelTab: string;
    tasks: { id: string; status: string; [key: string]: unknown }[];
    fileRefs: { id: string; file_path?: string; [key: string]: unknown }[];
    allSessions: PageSession[];
    linkedChatId: string;
    linkedChatMessages: Record<string, unknown>[];
    linkedChatHasMore: boolean;
    linkedChatLoadingMore: boolean;
    activeTasks: { id: string; status: string; [key: string]: unknown }[];
    openTaskCount: number;
    bookmarkedMessages: Record<string, unknown>[];
    memories: Record<string, unknown>[];
    memorySearch: string;
    memorySearchResults: Record<string, unknown>[];
    memorySearching: boolean;
    // participants data — computed by parent from messages + allSessions
    participantsActive: { sess: PageSession; count: number; active: boolean }[];
    participantsAvailable: { sess: PageSession; count: number; active: boolean }[];
    onTabChange: (tab: string) => void;
    onTaskUpdated: (task: { id: string; status: string; [key: string]: unknown }) => void;
    onFileRefRemoved: (id: string) => void;
    onLinkedChatIdChange: (id: string) => void;
    onLoadLinkedChat: (id: string) => void;
    onLoadOlderLinkedChat: () => void;
    onPostToLinkedChat: (text: string) => void;
    onAgentRespond: (sessionId: string, payload: unknown) => void;
    onAddMemory: (key: string, value: string) => void;
    onDeleteMemory: (id: unknown) => void;
    onMemorySearchChange: (q: string) => void;
    onCrossPost: (targetId: string, text: string) => void;
    onWakeParticipant: (sess: PageSession) => void;
    onSaveNickname: (sess: PageSession, handle: string) => void;
    onCreateTask: (title: string) => void;
  }

  const {
    session,
    sessionId,
    panelTab,
    tasks,
    fileRefs,
    allSessions,
    linkedChatId,
    linkedChatMessages,
    linkedChatHasMore,
    linkedChatLoadingMore,
    activeTasks,
    openTaskCount,
    bookmarkedMessages,
    memories,
    memorySearch,
    memorySearchResults,
    memorySearching,
    participantsActive,
    participantsAvailable,
    onTabChange,
    onTaskUpdated,
    onFileRefRemoved,
    onLinkedChatIdChange,
    onLoadLinkedChat,
    onLoadOlderLinkedChat,
    onPostToLinkedChat,
    onAgentRespond,
    onAddMemory,
    onDeleteMemory,
    onMemorySearchChange,
    onCrossPost,
    onWakeParticipant,
    onSaveNickname,
    onCreateTask,
  }: Props = $props();

  // Panel-local state
  let newTaskTitle = $state('');
  let showNewTaskInput = $state(false);
  let editingNickname = $state<string | null>(null);
  let nicknameInput = $state('');
  let crossPostTarget = $state<string | null>(null);
  let crossPostText = $state('');
  let linkedChatInputLocal = $state('');
  let memoryNewKey = $state('');
  let memoryNewValue = $state('');

  function groupMessages(msgs: Record<string, unknown>[]): { key: string; type: string; items: Record<string, unknown>[] }[] {
    const groups: { key: string; type: string; items: Record<string, unknown>[] }[] = [];
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

  function handleColour(h: string): string {
    const palette = ['#6366F1','#22C55E','#F59E0B','#EC4899','#26A69A','#AB47BC','#42A5F5','#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
  }

  function handleLinkedChatSend() {
    if (!linkedChatInputLocal.trim()) return;
    onPostToLinkedChat(linkedChatInputLocal.trim());
    linkedChatInputLocal = '';
  }

  function handleCreateTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    onCreateTask(title);
    newTaskTitle = '';
    showNewTaskInput = false;
  }

  function handleSaveNickname(sess: PageSession) {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { editingNickname = null; return; }
    onSaveNickname(sess, trimmed);
    editingNickname = null;
  }

  function handleCrossPost(targetId: string) {
    if (!crossPostText.trim()) return;
    onCrossPost(targetId, crossPostText.trim());
    crossPostText = '';
    crossPostTarget = null;
  }

  function handleMemoryAdd() {
    const key = memoryNewKey.trim();
    const value = memoryNewValue.trim();
    if (!key || !value) return;
    onAddMemory(key, value);
    memoryNewKey = '';
    memoryNewValue = '';
  }

  const allFiles = $derived([
    ...fileRefs.filter(r => !r.file_path?.startsWith('msg:')),
    ...fileRefs.filter(r => r.file_path?.startsWith('msg:')),
  ]);
</script>

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
        onclick={() => onTabChange(tab)}
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
        {#if participantsActive.length > 0}
          <p class="text-[10px] font-semibold uppercase tracking-wide pt-1" style="color:var(--text-faint);">Active here</p>
          {#each participantsActive as p}
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
                        if (e.key === 'Enter') handleSaveNickname(p.sess);
                        if (e.key === 'Escape') editingNickname = null;
                      }}
                      onblur={() => handleSaveNickname(p.sess)}
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
                      onclick={() => onWakeParticipant(p.sess)}
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
                      onkeydown={(e) => { if (e.key === 'Enter') handleCrossPost(p.sess.id); if (e.key === 'Escape') crossPostTarget = null; }}
                    />
                    <button onclick={() => handleCrossPost(p.sess.id)} class="px-2 py-1 text-xs rounded font-medium" style="background:#6366F1;color:#fff;">↗</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        <!-- All other sessions (available, not yet active here) -->
        {#if participantsAvailable.length > 0}
          <p class="text-[10px] font-semibold uppercase tracking-wide pt-1" style="color:var(--text-faint);">All sessions</p>
          {#each participantsAvailable as p}
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
                      onclick={() => onWakeParticipant(p.sess)}
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
                      onkeydown={(e) => { if (e.key === 'Enter') handleCrossPost(p.sess.id); if (e.key === 'Escape') crossPostTarget = null; }}
                    />
                    <button onclick={() => handleCrossPost(p.sess.id)} class="px-2 py-1 text-xs rounded font-medium" style="background:#6366F1;color:#fff;">↗</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        {#if participantsActive.length === 0 && participantsAvailable.length === 0}
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
              onkeydown={(e) => { if (e.key === 'Enter') handleCreateTask(); if (e.key === 'Escape') { showNewTaskInput = false; newTaskTitle = ''; } }}
            />
            <button onclick={handleCreateTask} disabled={!newTaskTitle.trim()} class="px-2 text-xs rounded font-medium disabled:opacity-40" style="background:#6366F1;color:#fff;">+</button>
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
              onUpdated={(u) => { onTaskUpdated(u); }}
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
              onRemoved={(id) => { onFileRefRemoved(id); }}
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
                    <p class="font-mono text-[10px] mb-0.5" style="color:{handleColour(m.sender_id as string)};">{m.sender_id}</p>
                  {/if}
                  <p class="text-gray-300 truncate">{(m.content as string).slice(0,80)}</p>
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
            value={linkedChatId}
            onchange={(e) => { const id = (e.target as HTMLSelectElement).value; onLinkedChatIdChange(id); onLoadLinkedChat(id); }}
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
            {#if linkedChatLoadingMore}
              <div class="flex justify-center py-2 text-xs" style="color:var(--text-muted);">Loading older messages…</div>
            {:else if linkedChatHasMore}
              <div class="flex justify-center py-1">
                <button onclick={onLoadOlderLinkedChat} class="text-xs px-3 py-1 rounded-full border" style="border-color:var(--border-subtle);color:var(--text-muted);">Load older</button>
              </div>
            {/if}
            {#each groupMessages(linkedChatMessages) as group (group.key)}
              {#if group.type === 'terminal_line'}
                <TerminalLine messages={group.items} />
              {:else if group.type === 'agent_event'}
                <AgentEventCard
                  message={group.items[0]}
                  sessionId={linkedChatId}
                  onRespond={async (payload) => { onAgentRespond(linkedChatId, payload); }}
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
                bind:value={linkedChatInputLocal}
                onkeydown={(e) => { if (e.key === 'Enter') handleLinkedChatSend(); }}
              />
              <button onclick={handleLinkedChatSend} disabled={!linkedChatInputLocal.trim()}
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
            value={memorySearch}
            oninput={(e) => onMemorySearchChange((e.target as HTMLInputElement).value)}
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
            onkeydown={(e) => { if (e.key === 'Enter') handleMemoryAdd(); }}
          />
          <div class="flex gap-1">
            <input
              bind:value={memoryNewValue}
              placeholder="Value…"
              class="flex-1 text-xs rounded px-2 py-1 outline-none"
              style="background:var(--bg);border:1px solid var(--border-subtle);color:var(--text);"
              onkeydown={(e) => { if (e.key === 'Enter') handleMemoryAdd(); }}
            />
            <button onclick={handleMemoryAdd} disabled={!memoryNewKey.trim() || !memoryNewValue.trim()}
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
                    onclick={() => onDeleteMemory(mem.id)}
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
