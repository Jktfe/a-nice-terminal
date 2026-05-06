<script lang="ts">
  import { onMount } from 'svelte';
  import MessageBubble from './MessageBubble.svelte';
  import PinnedAsksPanel from './PinnedAsksPanel.svelte';
  import { insertAtCursor as computeInsertAtCursor } from './chat-composer-utils.js';

  let { sessionId }: { sessionId: string } = $props();

  interface Message {
    id: string;
    role: string;
    content: string;
    format: string;
    status: string;
    sender_id?: string;
    handle?: string;
    sender_type?: string;
    created_at: string;
    meta?: string;
  }

  const PAGE_SIZE = 50;

  let messages = $state<Message[]>([]);
  let inputText = $state('');
  let atBottom = $state(true);
  let scrollEl = $state<HTMLElement | null>(null);
  let streamingId = $state<string | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let composerWrap = $state<HTMLElement | null>(null);
  let isDragOver = $state(false);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let hasMoreHistory = $state(true);
  let loadingHistory = $state(false);

  function handleJumpToMessage(event: Event) {
    const detail = (event as CustomEvent<{ messageId?: string }>).detail;
    const id = detail?.messageId;
    if (!id || !scrollEl) return;
    const target = scrollEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function onScroll() {
    if (!scrollEl) return;
    const threshold = 60;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < threshold;
    // Trigger lazy-load when user scrolls near the top of the visible history.
    if (scrollEl.scrollTop < 100 && hasMoreHistory && !loadingHistory && messages.length > 0) {
      void loadOlder();
    }
  }

  async function loadOlder() {
    if (loadingHistory || !hasMoreHistory) return;
    const oldest = messages[0];
    if (!oldest) return;
    loadingHistory = true;
    try {
      const before = encodeURIComponent(oldest.created_at);
      const res = await fetch(
        `/api/sessions/${sessionId}/messages?before=${before}&limit=${PAGE_SIZE}`,
      );
      const data = await res.json();
      const older: Message[] = Array.isArray(data) ? data : (data.messages ?? []);
      if (older.length === 0) {
        hasMoreHistory = false;
        return;
      }
      hasMoreHistory = older.length === PAGE_SIZE;
      // Restore scroll position so the user stays anchored to the message
      // they were reading rather than jumping back to the new top.
      const el = scrollEl;
      const prevScrollHeight = el ? el.scrollHeight : 0;
      // Filter out any duplicates already in the array (defensive against
      // overlapping `before` boundaries).
      const existingIds = new Set(messages.map((m) => m.id));
      const fresh = older.filter((m) => !existingIds.has(m.id));
      messages = [...fresh, ...messages];
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevScrollHeight;
        });
      }
    } finally {
      loadingHistory = false;
    }
  }

  $effect(() => {
    // Auto-scroll when messages change if user is near the bottom
    messages;
    streamingId;
    if (atBottom) setTimeout(scrollToBottom, 0);
  });

  async function sendMessage() {
    const text = inputText.trim();
    if (!text) return;
    inputText = '';
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: text, format: 'text' }),
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function insertAtCursor(insert: string) {
    const el = textareaEl;
    if (!el) {
      // No textarea bound yet — fall back to a plain append with a space
      // separator. This is the same "no caret context" path the helper
      // produces when selectionStart/end are null.
      const result = computeInsertAtCursor({
        text: inputText,
        selectionStart: null,
        selectionEnd: null,
        insert,
      });
      inputText = result.text;
      return;
    }
    const result = computeInsertAtCursor({
      text: inputText,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      insert,
    });
    inputText = result.text;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    }, 0);
  }

  async function uploadAndInsert(file: File) {
    uploadError = null;
    uploading = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        uploadError = `Upload failed (${res.status}) ${txt.slice(0, 120)}`.trim();
        return;
      }
      const data = await res.json().catch(() => null);
      const md = data?.markdown || (data?.url ? `![image](${data.url})` : null);
      if (md) insertAtCursor(md);
      else uploadError = 'Upload returned no URL';
    } catch (e) {
      uploadError = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      uploading = false;
    }
  }

  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await uploadAndInsert(file);
        }
      }
    }
  }

  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    isDragOver = true;
  }
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: DragEvent) {
    // dragleave fires on every child crossing — only clear when we leave the wrapper itself.
    const next = e.relatedTarget as Node | null;
    if (next && composerWrap?.contains(next)) return;
    isDragOver = false;
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    for (const f of files) {
      // sequential so we can show one error at a time
      // eslint-disable-next-line no-await-in-loop
      await uploadAndInsert(f);
    }
  }

  onMount(() => {
    let ws: WebSocket | null = null;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Load the most recent page only — older pages stream in via loadOlder()
    // when the user scrolls near the top.
    fetch(`/api/sessions/${sessionId}/messages?limit=${PAGE_SIZE}`)
      .then(r => r.json())
      .then(data => {
        const initial: Message[] = Array.isArray(data) ? data : (data.messages ?? []);
        messages = initial;
        hasMoreHistory = initial.length === PAGE_SIZE;
        setTimeout(scrollToBottom, 0);
      })
      .catch(() => {});

    function connect() {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}/ws`);

      ws.onopen = () => {
        ws!.send(JSON.stringify({ type: 'join_session', sessionId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.sessionId && data.sessionId !== sessionId) return;

          switch (data.type) {
            case 'message_created':
              if (!messages.find(m => m.id === data.id)) {
                messages = [...messages, data];
              }
              break;
            case 'message_updated':
              if (data.status === 'complete' || data.status === 'incomplete') {
                streamingId = null;
              }
              messages = messages.map(m =>
                m.id === data.msgId ? { ...m, meta: JSON.stringify(data.meta), status: data.status ?? m.status } : m
              );
              break;
            case 'message_deleted':
              messages = messages.filter(m => m.id !== data.msgId);
              if (streamingId === data.msgId) streamingId = null;
              break;
            case 'stream_chunk': {
              const { messageId, content } = data;
              const existing = messages.find(m => m.id === messageId);
              if (existing) {
                messages = messages.map(m =>
                  m.id === messageId ? { ...m, content: m.content + content, status: 'streaming' } : m
                );
              } else {
                messages = [...messages, {
                  id: messageId,
                  role: 'assistant',
                  content,
                  format: 'text',
                  status: 'streaming',
                  created_at: new Date().toISOString(),
                }];
              }
              streamingId = messageId;
              break;
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!destroyed) reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    window.addEventListener('jump-to-message', handleJumpToMessage);

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      window.removeEventListener('jump-to-message', handleJumpToMessage);
    };
  });
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <PinnedAsksPanel messages={messages} {sessionId} />
  <!-- Message feed -->
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1"
    style="background: var(--bg);"
  >
    {#if messages.length === 0}
      <div class="flex items-center justify-center h-full">
        <p class="text-xs" style="color: var(--text-faint);">No messages yet</p>
      </div>
    {:else}
      {#if loadingHistory}
        <div class="flex items-center justify-center py-2 text-[10px]" style="color: var(--text-faint);">
          Loading earlier messages…
        </div>
      {:else if !hasMoreHistory}
        <div class="flex items-center justify-center py-2 text-[10px]" style="color: var(--text-faint);">
          Start of conversation
        </div>
      {/if}
      {#each messages as msg (msg.id)}
        <div data-message-id={msg.id}>
          <MessageBubble message={msg} {sessionId} />
        </div>
      {/each}
    {/if}
  </div>

  <!-- Compact input + image dropzone (paste/drag PNG/JPG → /api/upload → insert markdown) -->
  <div
    bind:this={composerWrap}
    ondragenter={onDragEnter}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    role="group"
    aria-label="Message composer with image drop zone"
    class="relative flex flex-col border-t flex-shrink-0"
    style="border-color: var(--border-light); background: var(--bg-surface);"
  >
    {#if uploadError}
      <div class="px-2 py-1 text-[10px] flex items-center justify-between gap-2"
        style="background: #FEF2F2; color: #B91C1C; border-bottom: 1px solid #FCA5A5;">
        <span class="truncate">{uploadError}</span>
        <button onclick={() => (uploadError = null)} class="text-[10px] underline" style="color: #B91C1C;">dismiss</button>
      </div>
    {/if}
    <div class="flex items-center gap-1 px-2 py-1.5">
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        placeholder={uploading ? 'Uploading image…' : 'Message… (paste or drop an image)'}
        rows="1"
        class="flex-1 resize-none rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
        style="background: var(--bg-input); color: var(--text); max-height: 80px;"
      ></textarea>
      <button
        onclick={sendMessage}
        disabled={!inputText.trim() || uploading}
        class="px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40"
        style="background: #6366F1; color: #fff;"
        title="Send (Enter)"
      >▶</button>
    </div>
    {#if isDragOver}
      <div
        class="absolute inset-0 pointer-events-none flex items-center justify-center text-xs font-semibold"
        style="background: rgba(99, 102, 241, 0.12); border: 2px dashed #6366F1; color: #4F46E5; border-radius: 6px;"
      >
        Drop image to attach
      </div>
    {/if}
  </div>
</div>
