<script lang="ts">
  import TaskCard from '$lib/components/TaskCard.svelte';
  import FileRefCard from '$lib/components/FileRefCard.svelte';
  import AgentEventCard from '$lib/components/AgentEventCard.svelte';
  import TerminalLine from '$lib/components/TerminalLine.svelte';
  import ChatParticipants from '$lib/components/ChatParticipants.svelte';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
    meta?: string | Record<string, unknown> | null;
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
    participantsActive: { sess: PageSession; count: number; active: boolean }[];
    participantsAvailable: { sess: PageSession; count: number; active: boolean }[];
    postsFrom: Record<string, unknown>[];
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
    onRemoveParticipant: (sess: PageSession) => void;
    onOpenLinkedChat: (sess: PageSession) => void;
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
    postsFrom = [],
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
    onRemoveParticipant,
    onOpenLinkedChat,
    onCreateTask,
  onClose = undefined,
  }: Props & { onClose?: () => void } = $props();

  // Panel-local state
  let newTaskTitle = $state('');
  let showNewTaskInput = $state(false);
  let linkedChatInputLocal = $state('');
  let memoryNewKey = $state('');
  let memoryNewValue = $state('');
  let defaultsApplied = $state(false);

  // Which sections are expanded
  let participantsOpen = $state(true);
  let tasksOpen = $state(true);
  let filesOpen = $state(true);
  let chatRoomsOpen = $state(true);
  let memoryOpen = $state(false);

  $effect(() => {
    if (defaultsApplied || !session || session.type === 'terminal') return;
    tasksOpen = false;
    filesOpen = false;
    memoryOpen = false;
    defaultsApplied = true;
  });

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

  // Deterministic colour from session id — with known colours for claude/gemini handles
  function handleColour(h: string): string {
    if (h === 'claude' || h?.includes('claude')) return '#4F46E5';
    if (h === 'gemini' || h?.includes('gemini')) return '#10B981';
    const palette = ['#6366F1', '#22C55E', '#F59E0B', '#EC4899', '#26A69A', '#AB47BC', '#42A5F5', '#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
  }

  function taskStatusIcon(status: string): { icon: string; colour: string } {
    if (status === 'complete') return { icon: 'circle-check', colour: '#10B981' };
    if (status === 'in_progress' || status === 'running') return { icon: 'loader', colour: '#F59E0B' };
    if (status === 'blocked' || status === 'failed') return { icon: 'x', colour: '#EF4444' };
    return { icon: 'circle-dot', colour: '#6366F1' };
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

  function handleMemoryAdd() {
    const key = memoryNewKey.trim();
    const value = memoryNewValue.trim();
    if (!key || !value) return;
    onAddMemory(key, value);
    memoryNewKey = '';
    memoryNewValue = '';
  }

  const allFileRefs = $derived([
    ...fileRefs.filter(r => !r.file_path?.startsWith('msg:')),
    ...fileRefs.filter(r => r.file_path?.startsWith('msg:')),
  ]);

  const isTerminal = $derived(session?.type === 'terminal');
  const selectableChats = $derived(
    allSessions.filter(s => s.type === 'chat' && (!isAutoLinkedChatSession(s) || s.id === linkedChatId))
  );

  // Phase 6: map cli_flag to a display label
  function cliLabel(flag: string | null | undefined): string {
    if (!flag) return '';
    const labels: Record<string, string> = {
      claude: 'Claude',
      gemini: 'Gemini',
      copilot: 'Copilot',
      aider: 'Aider',
      cursor: 'Cursor',
      codex: 'Codex',
    };
    return labels[flag] || flag;
  }
</script>

<!-- Panel: full-width overlay on mobile, 280px fixed on lg+ -->
<div
  class="flex flex-col border-l overflow-hidden
         fixed inset-y-0 right-0 z-50 w-full
         lg:static lg:w-[280px] lg:z-auto"
  style="max-width: 100vw; border-color: #E5E7EB; background: var(--bg);"
>
  <!-- Mobile close bar -->
  <div class="flex items-center justify-between px-4 py-2 border-b lg:hidden flex-shrink-0"
       style="border-color: #E5E7EB;">
    <span class="text-sm font-semibold" style="color: var(--text);">Panel</span>
    <button
      onclick={() => onClose?.()}
      class="p-1.5 rounded-lg"
      style="color: var(--text-muted);"
      aria-label="Close panel"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  </div>
  <div class="flex-1 overflow-y-auto min-h-0 divide-y" style="divide-color: #F3F4F6;">

    <!-- ─── SECTION: Participants / Chat Rooms ─── -->
    <div>
      <!-- Section header -->
      <button
        onclick={() => isTerminal ? (chatRoomsOpen = !chatRoomsOpen) : (participantsOpen = !participantsOpen)}
        class="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50"
        style="background: var(--bg);"
      >
        <div class="flex items-center gap-2">
          <!-- users icon -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #6366F1;">
            {#if isTerminal}
              <!-- message-square icon for Chat Rooms -->
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 20h5v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2h5M12 11a4 4 0 100-8 4 4 0 000 8z"/>
            {/if}
          </svg>
          <span class="text-xs font-semibold" style="color: var(--text);">
            {isTerminal ? 'Chat Rooms' : 'Participants'}
          </span>
        </div>
        <!-- chevron -->
        <svg
          class="w-3.5 h-3.5 transition-transform"
          style="color: var(--text-faint); transform: {(isTerminal ? chatRoomsOpen : participantsOpen) ? 'rotate(180deg)' : 'rotate(0deg)'};"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {#if (isTerminal ? chatRoomsOpen : participantsOpen)}
        <div class="px-3 pb-3 space-y-1.5">

          {#if isTerminal}
            <!-- Chat room selector + feed -->
            <select
              value={linkedChatId}
              onchange={(e) => { const id = (e.target as HTMLSelectElement).value; onLinkedChatIdChange(id); onLoadLinkedChat(id); }}
              class="w-full text-xs rounded-lg px-2 py-1.5 outline-none mb-2"
              style="background: #F3F4F6; border: 1px solid #E5E7EB; color: var(--text);"
            >
              <option value="">— pick chat session —</option>
              {#each selectableChats as s}
                <option value={s.id}>{s.display_name || s.name}</option>
              {/each}
            </select>

            {#if linkedChatId}
              <!-- Mini feed (max height) -->
              <div class="rounded-lg overflow-hidden" style="border: 1px solid #E5E7EB; max-height: 200px; overflow-y: auto;">
                <div class="p-2 space-y-1">
                  {#if linkedChatMessages.length === 0}
                    <p class="text-center text-xs py-3" style="color: var(--text-faint);">No messages yet</p>
                  {:else}
                    {#if linkedChatLoadingMore}
                      <div class="text-center text-xs py-1" style="color: var(--text-muted);">Loading…</div>
                    {:else if linkedChatHasMore}
                      <div class="flex justify-center py-1">
                        <button onclick={onLoadOlderLinkedChat} class="text-xs px-2 py-0.5 rounded-full border" style="border-color: #E5E7EB; color: var(--text-muted);">Load older</button>
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
                          onDiscard={async (message) => {
                            await fetch(`/api/sessions/${linkedChatId}/messages?msgId=${message.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ meta: { status: 'discarded', chosen: 'discard' } }),
                            });
                          }}
                        />
                      {:else}
                        {@const m = group.items[0]}
                        {@const senderSess = allSessions.find(s => s.id === m.sender_id || s.handle === m.sender_id)}
                        {@const senderName = senderSess ? (senderSess.display_name || senderSess.name) : (m.sender_id || (m.role === 'user' ? 'You' : 'AI'))}
                        {@const col = m.sender_id ? handleColour(m.sender_id as string) : (m.role === 'user' ? '#4B5563' : '#6366F1')}
                        <div class="text-xs rounded-lg px-2.5 py-1.5" style="background: #F9FAFB; border-left: 2px solid {col};">
                          <p class="font-semibold font-mono text-[10px] mb-0.5" style="color: {col};">{senderName}</p>
                          <p class="break-words line-clamp-3" style="color: var(--text);">{m.content}</p>
                        </div>
                      {/if}
                    {/each}
                  {/if}
                </div>
              </div>

              <!-- Quick reply -->
              <div class="flex gap-1.5 mt-1.5">
                <input
                  class="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none"
                  style="background: #F3F4F6; border: 1px solid #E5E7EB; color: var(--text);"
                  placeholder="Post to chat…"
                  bind:value={linkedChatInputLocal}
                  onkeydown={(e) => { if (e.key === 'Enter') handleLinkedChatSend(); }}
                />
                <button
                  onclick={handleLinkedChatSend}
                  disabled={!linkedChatInputLocal.trim()}
                  class="px-2.5 py-1.5 rounded-lg disabled:opacity-40 flex items-center"
                  style="background: #6366F1; color: #fff;"
                >
                  <!-- send icon -->
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                  </svg>
                </button>
              </div>
            {/if}

          {:else}
            <!-- Chat session participants with real-time presence -->
            <ChatParticipants
              {sessionId}
              {participantsActive}
              {participantsAvailable}
              onWakeParticipant={(sess) => onWakeParticipant(sess)}
              onSaveNickname={(sess, handle) => onSaveNickname(sess, handle)}
              onCrossPost={(targetId, text) => onCrossPost(targetId, text)}
              onRemoveParticipant={(sess) => onRemoveParticipant(sess)}
              onOpenLinkedChat={(sess) => onOpenLinkedChat(sess)}
            />
          {/if}
        </div>
      {/if}
    </div>

    <!-- ─── SECTION: Tasks / Agent Tasks ─── -->
    <div>
      <button
        onclick={() => (tasksOpen = !tasksOpen)}
        class="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50"
        style="background: var(--bg);"
      >
        <div class="flex items-center gap-2">
          <!-- check-square icon -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #6366F1;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span class="text-xs font-semibold" style="color: var(--text);">
            {isTerminal ? 'Agent Tasks' : 'Tasks'}
          </span>
          {#if openTaskCount > 0}
            <span
              class="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white"
              style="background: #6366F1;"
            >{openTaskCount}</span>
          {/if}
        </div>
        <svg
          class="w-3.5 h-3.5 transition-transform"
          style="color: var(--text-faint); transform: {tasksOpen ? 'rotate(180deg)' : 'rotate(0deg)'};"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {#if tasksOpen}
        <div class="px-3 pb-3 space-y-1.5">
          <!-- New task input / button -->
          {#if showNewTaskInput}
            <div class="flex gap-1.5">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                autofocus
                class="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none"
                style="border: 1px solid #6366F1; color: var(--text); background: var(--bg);"
                placeholder="Task title…"
                bind:value={newTaskTitle}
                onkeydown={(e) => { if (e.key === 'Enter') handleCreateTask(); if (e.key === 'Escape') { showNewTaskInput = false; newTaskTitle = ''; } }}
              />
              <button
                onclick={handleCreateTask}
                disabled={!newTaskTitle.trim()}
                class="px-2.5 py-1.5 text-xs rounded-lg font-medium disabled:opacity-40"
                style="background: #6366F1; color: #fff;"
              >+</button>
              <button
                onclick={() => { showNewTaskInput = false; newTaskTitle = ''; }}
                class="px-2 text-xs rounded-lg"
                style="color: var(--text-faint);"
              >✕</button>
            </div>
          {:else}
            <button
              onclick={() => (showNewTaskInput = true)}
              class="w-full py-1.5 text-xs rounded-lg border border-dashed transition-all text-center"
              style="border-color: #E5E7EB; color: var(--text-faint);"
            >+ New task</button>
          {/if}

          {#if activeTasks.length === 0}
            <div class="text-center py-6 opacity-50">
              <p class="text-xs" style="color: var(--text-muted);">No tasks yet</p>
            </div>
          {:else}
            {#each activeTasks as t (t.id)}
              {@const si = taskStatusIcon(t.status)}
              <div class="rounded-lg overflow-hidden" style="border: 1px solid #E5E7EB;">
                <div class="flex items-start gap-2.5 px-2.5 py-2">
                  <!-- Status icon -->
                  <span class="mt-0.5 flex-shrink-0">
                    {#if si.icon === 'circle-check'}
                      <svg class="w-4 h-4" fill="none" stroke={si.colour} viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke-width="2"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"/>
                      </svg>
                    {:else if si.icon === 'loader'}
                      <svg class="w-4 h-4 animate-spin" fill="none" stroke={si.colour} viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                    {:else if si.icon === 'x'}
                      <svg class="w-4 h-4" fill="none" stroke={si.colour} viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke-width="2"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 9l-6 6M9 9l6 6"/>
                      </svg>
                    {:else}
                      <!-- circle-dot (pending/default) -->
                      <svg class="w-4 h-4" fill="none" stroke={si.colour} viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke-width="2"/>
                        <circle cx="12" cy="12" r="3" fill={si.colour}/>
                      </svg>
                    {/if}
                  </span>
                  <div class="flex-1 min-w-0">
                    <TaskCard
                      task={t}
                      {sessionId}
                      {allSessions}
                      onUpdated={(u) => { onTaskUpdated(u); }}
                    />
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- ─── SECTION: File References ─── -->
    <div>
      <button
        onclick={() => (filesOpen = !filesOpen)}
        class="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50"
        style="background: var(--bg);"
      >
        <div class="flex items-center gap-2">
          <!-- file-code icon -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #6366F1;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span class="text-xs font-semibold" style="color: var(--text);">File References</span>
          {#if allFileRefs.length > 0}
            <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style="background: #F3F4F6; color: #6B7280;">{allFileRefs.length}</span>
          {/if}
        </div>
        <svg
          class="w-3.5 h-3.5 transition-transform"
          style="color: var(--text-faint); transform: {filesOpen ? 'rotate(180deg)' : 'rotate(0deg)'};"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {#if filesOpen}
        <div class="px-3 pb-3 space-y-1">
          {#if allFileRefs.length === 0 && bookmarkedMessages.length === 0}
            <div class="text-center py-6 opacity-50">
              <p class="text-xs" style="color: var(--text-muted);">No flagged files</p>
              <p class="text-[11px] mt-0.5" style="color: var(--text-faint);">Use 🔖 on a message or <code class="font-mono">ant flag</code></p>
            </div>
          {:else}
            {#each fileRefs.filter(r => !r.file_path?.startsWith('msg:')) as r (r.id)}
              <div class="flex items-center gap-2 rounded-lg px-2.5 py-2 group" style="border: 1px solid #E5E7EB; background: #FAFAFA;">
                <!-- file-code icon -->
                <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #6366F1;">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                </svg>
                <span class="flex-1 min-w-0 text-xs truncate font-mono" style="color: var(--text);">{r.file_path || r.id}</span>
                <button
                  onclick={() => onFileRefRemoved(r.id)}
                  class="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  style="color: var(--text-faint);"
                  title="Remove reference"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            {/each}

            {#if bookmarkedMessages.length > 0}
              <p class="text-[10px] font-semibold uppercase tracking-wide mt-2 mb-1 px-1" style="color: var(--text-faint);">Bookmarked messages</p>
              {#each bookmarkedMessages as m (m.id)}
                <div class="flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs group" style="background: #FAFAFA; border: 1px solid #E5E7EB;">
                  <span class="text-yellow-400 mt-0.5 flex-shrink-0">🔖</span>
                  <div class="flex-1 min-w-0">
                    {#if m.sender_id}
                      <p class="font-mono text-[10px] mb-0.5" style="color: {handleColour(m.sender_id as string)};">{m.sender_id}</p>
                    {/if}
                    <p class="truncate" style="color: var(--text);">{(m.content as string).slice(0, 80)}</p>
                  </div>
                </div>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- ─── SECTION: Memory (collapsed by default) ─── -->
    <div>
      <button
        onclick={() => (memoryOpen = !memoryOpen)}
        class="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50"
        style="background: var(--bg);"
      >
        <div class="flex items-center gap-2">
          <!-- brain icon -->
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #6366F1;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9.663 17h4.673M12 3c-1.2 0-2.4.6-3 1.5C7.5 4 6 4.5 5.25 5.4A4.5 4.5 0 003 9.75c0 1.2.45 2.25 1.2 3.075C3.75 14.175 3.75 15.9 4.5 17.25 5.25 18.6 6.6 19.5 8.25 19.5h.75v.75a.75.75 0 001.5 0V19.5h3v.75a.75.75 0 001.5 0V19.5h.75c1.65 0 3-1.05 3.75-2.25.75-1.35.75-3.075.3-4.425A4.5 4.5 0 0021 9.75a4.5 4.5 0 00-2.25-3.9c-.75-.9-2.25-1.35-3.75-1.35-.6-1.05-1.8-1.5-3-1.5z"/>
          </svg>
          <span class="text-xs font-semibold" style="color: var(--text);">Memory</span>
          {#if memories.length > 0}
            <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style="background: #F3F4F6; color: #6B7280;">{memories.length}</span>
          {/if}
        </div>
        <svg
          class="w-3.5 h-3.5 transition-transform"
          style="color: var(--text-faint); transform: {memoryOpen ? 'rotate(180deg)' : 'rotate(0deg)'};"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {#if memoryOpen}
        <div class="px-3 pb-3 space-y-2">
          <!-- Search -->
          <input
            value={memorySearch}
            oninput={(e) => onMemorySearchChange((e.target as HTMLInputElement).value)}
            placeholder="Search memory…"
            class="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none"
            style="border: 1px solid #E5E7EB; color: var(--text); background: #F9FAFB;"
          />
          <!-- Add new -->
          <div class="space-y-1.5">
            <input
              bind:value={memoryNewKey}
              placeholder="Key (e.g. project-goal)"
              class="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none"
              style="border: 1px solid #E5E7EB; color: var(--text); background: var(--bg);"
              onkeydown={(e) => { if (e.key === 'Enter') handleMemoryAdd(); }}
            />
            <div class="flex gap-1.5">
              <input
                bind:value={memoryNewValue}
                placeholder="Value…"
                class="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none"
                style="border: 1px solid #E5E7EB; color: var(--text); background: var(--bg);"
                onkeydown={(e) => { if (e.key === 'Enter') handleMemoryAdd(); }}
              />
              <button
                onclick={handleMemoryAdd}
                disabled={!memoryNewKey.trim() || !memoryNewValue.trim()}
                class="px-2.5 py-1.5 text-xs rounded-lg font-medium disabled:opacity-40"
                style="background: #6366F1; color: #fff;"
              >Save</button>
            </div>
          </div>
          <!-- List -->
          <div class="space-y-1.5 max-h-60 overflow-y-auto">
            {#if memorySearching}
              <p class="text-center text-xs py-3" style="color: var(--text-faint);">Searching…</p>
            {:else if (memorySearch.trim() ? memorySearchResults : memories).length === 0}
              <p class="text-center text-xs py-3 opacity-50" style="color: var(--text-muted);">{memorySearch ? 'No results' : 'No memories yet'}</p>
            {:else}
              {#each (memorySearch.trim() ? memorySearchResults : memories) as mem (mem.id)}
                <div class="rounded-lg px-2.5 py-2 group/mem text-xs" style="border: 1px solid #E5E7EB; background: #FAFAFA;">
                  <div class="flex items-start justify-between gap-1">
                    <p class="font-mono font-semibold text-[11px] truncate flex-1" style="color: #6366F1;">{mem.key}</p>
                    <button
                      onclick={() => onDeleteMemory(mem.id)}
                      class="opacity-0 group-hover/mem:opacity-100 transition-all flex-shrink-0"
                      style="color: var(--text-faint);"
                      title="Delete memory"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                  {#if mem.snippet}
                    <p class="mt-0.5 break-words line-clamp-3" style="color: var(--text-muted);">{@html mem.snippet}</p>
                  {:else}
                    <p class="mt-0.5 break-words line-clamp-3" style="color: var(--text-muted);">{mem.value}</p>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>

  </div>
</div>
