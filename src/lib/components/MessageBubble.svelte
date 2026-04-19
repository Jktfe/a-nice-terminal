<script lang="ts">
  import { marked } from 'marked';

  // Simple renderer: inline markdown (bold, italic, code, links, line breaks)
  // No full block rendering to keep bubble layout tight
  function renderMarkdown(text: string): string {
    if (!text) return '';
    return marked.parse(text, { breaks: true, gfm: true }) as string;
  }

  let {
    message,
    sessionId,
    allSessions = [],
    readReceipts = [],
    onReply,
    onDeleted,
    onMetaUpdated,
  }: {
    message: any;
    sessionId: string;
    allSessions?: any[];
    readReceipts?: { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }[];
    onReply?: (msg: any) => void;
    onDeleted?: (id: string) => void;
    onMetaUpdated?: (id: string, meta: any) => void;
  } = $props();

  // Identity logic:
  // - sender_id set → participant message (always left-aligned, handle badge visible)
  // - sender_id null + role 'user' → browser-typed message (right-aligned, "You")
  // - sender_id null + role 'assistant' → AI response (left-aligned, "AI")
  const isOwn = $derived(!message.sender_id && message.role === 'user');
  const isAi  = $derived(!message.sender_id && message.role !== 'user');
  const handle = $derived(message.sender_id || null);

  // Resolve sender_id to a session name (UUID → session name, handle → session name)
  const resolvedSession = $derived(
    handle ? allSessions.find((s: any) => s.id === handle || s.handle === handle) : null
  );

  function handleColour(h: string): string {
    const palette = ['#6366F1','#22C55E','#F59E0B','#EC4899','#26A69A','#AB47BC','#42A5F5','#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
  }

  // Use session ID as the colour key for consistent colours
  const colourKey = $derived(resolvedSession?.id ?? handle ?? '');

  const colour = $derived(
    handle ? handleColour(colourKey) :
    isAi   ? '#6366F1' :
              '#4B5563'   // neutral grey for "you" bubble
  );

  const avatarLabel = $derived(
    resolvedSession ? (resolvedSession.display_name || resolvedSession.name).slice(0,2).toUpperCase() :
    handle          ? handle.replace('@','').slice(0,2).toUpperCase() :
    isAi            ? 'AI' :
                      'ME'
  );

  const displayName = $derived(
    resolvedSession ? (resolvedSession.display_name || resolvedSession.name) :
    handle          ? handle :
    isAi            ? 'Assistant' : 'You'
  );

  // Parse meta for reactions and bookmark state
  let parsedMeta = $derived.by(() => {
    try { return JSON.parse(message.meta || '{}'); } catch { return {}; }
  });
  const reactions = $derived(parsedMeta.reactions ?? { up: 0, down: 0 });
  const bookmarked = $derived(!!parsedMeta.bookmarked);

  // Timestamp
  const timeStr = $derived.by(() => {
    if (!message.created_at) return '';
    const utc = message.created_at.includes('Z') || message.created_at.includes('+')
      ? message.created_at
      : message.created_at.replace(' ', 'T') + 'Z';
    return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  // Target badge (only show non-@everyone targets)
  const targetBadge = $derived(
    message.target && message.target !== '@everyone' ? message.target : null
  );

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
    const newMeta = { ...parsedMeta, bookmarked: newBookmarked };

    // Also create/remove a file-ref so it appears in the Files panel
    if (newBookmarked) {
      const note = message.content.slice(0, 80).replace(/\n/g, ' ');
      await fetch(`/api/sessions/${sessionId}/file-refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: `msg:${message.id}`,
          note: `💬 ${note}`,
          flagged_by: handle || 'web',
        }),
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

  async function deleteMsg() {
    await fetch(`/api/sessions/${sessionId}/messages?msgId=${message.id}`, { method: 'DELETE' });
    onDeleted?.(message.id);
  }
</script>

<!-- Wrapper: left for participants/AI, right for own messages -->
<div class="group flex gap-1 sm:gap-2 items-end min-w-0 overflow-hidden" class:flex-row-reverse={isOwn}>

  <!-- Avatar (hidden for own messages on mobile, shown on larger screens) -->
  {#if !isOwn}
    <div class="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white self-end mb-0.5"
         style="background: {colour};">
      {avatarLabel}
    </div>
  {/if}

  <div class="flex flex-col max-w-[85%] sm:max-w-[75%] min-w-0" class:items-end={isOwn}>
    <!-- Sender row -->
    <div class="flex items-center gap-1.5 mb-0.5 px-1" class:flex-row-reverse={isOwn}>
      <span class="text-[11px] font-semibold font-mono" style="color: {colour};">{displayName}</span>
      {#if targetBadge}
        <span class="text-[10px] text-gray-500">→ <span class="font-mono" style="color:{colour}88;">{targetBadge}</span></span>
      {/if}
      <span class="text-[10px] text-gray-600">{timeStr}</span>
      {#if bookmarked}
        <span class="text-[10px]" title="Bookmarked">🔖</span>
      {/if}
    </div>

    <!-- Bubble -->
    <div class="relative px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm"
         class:rounded-br-sm={isOwn}
         class:rounded-bl-sm={!isOwn}
         style={isOwn
           ? `background: ${colour}22; border: 1px solid ${colour}44; color: var(--text);`
           : `background: var(--bg-card); border: 1px solid ${colour}44; color: var(--text); border-left: 2px solid ${colour};`}>
      <div class="prose prose-sm break-words max-w-none
                  [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
                  [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5
                  [&_strong]:font-semibold [&_code]:px-1 [&_code]:py-px [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                  [&_pre]:my-1 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:text-xs"
           style="--tw-prose-body: var(--text); --tw-prose-headings: var(--text); --tw-prose-bold: var(--text); --tw-prose-code: var(--text); --tw-prose-bullets: var(--text-muted); color: var(--text);">{@html renderMarkdown(message.content)}</div>
      {#if message.status === 'streaming'}
        <span class="animate-pulse" style="color:{colour};">▌</span>
      {/if}
    </div>

    <!-- Reaction counts (shown when non-zero) -->
    {#if reactions.up > 0 || reactions.down > 0}
      <div class="flex gap-1.5 mt-0.5 px-1">
        {#if reactions.up > 0}
          <span class="text-[11px] bg-[#1A1A22] px-1.5 py-0.5 rounded-full border border-[#ffffff10]">
            👍 {reactions.up}
          </span>
        {/if}
        {#if reactions.down > 0}
          <span class="text-[11px] bg-[#1A1A22] px-1.5 py-0.5 rounded-full border border-[#ffffff10]">
            👎 {reactions.down}
          </span>
        {/if}
      </div>
    {/if}

    <!-- Read receipts -->
    {#if readReceipts.length > 0}
      <div class="flex items-center gap-0.5 mt-0.5 px-1" class:justify-end={isOwn}>
        {#each readReceipts as reader}
          <span
            class="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white cursor-default"
            style="background: {handleColour(reader.session_id)};"
            title="Seen by {reader.reader_name}"
          >{(reader.reader_name || '?').slice(0, 1).toUpperCase()}</span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Action row — always visible on mobile (touch), hover-only on desktop -->
  <div class="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150 self-end mb-1 flex-shrink-0"
       class:flex-row-reverse={!isOwn}>
    <button
      onclick={() => react('up')}
      class="p-1 rounded hover:bg-[#ffffff10] text-gray-500 hover:text-yellow-400 transition-colors text-sm"
      title="Thumbs up"
    >👍</button>
    <button
      onclick={() => react('down')}
      class="p-1 rounded hover:bg-[#ffffff10] text-gray-500 hover:text-red-400 transition-colors text-sm"
      title="Thumbs down"
    >👎</button>
    <button
      onclick={() => onReply?.(message)}
      class="p-1 rounded hover:bg-[#ffffff10] text-gray-500 hover:text-blue-400 transition-colors"
      title="Reply"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
      </svg>
    </button>
    <button
      onclick={toggleBookmark}
      class="p-1 rounded hover:bg-[#ffffff10] transition-colors"
      class:text-yellow-400={bookmarked}
      class:text-gray-500={!bookmarked}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark message'}
    >
      <svg class="w-3.5 h-3.5" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
      </svg>
    </button>
    <button
      onclick={deleteMsg}
      class="p-1 rounded hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-colors"
      title="Delete message"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
      </svg>
    </button>
  </div>
</div>
