<script lang="ts">
  let {
    onSend,
    replyTo = null,
    onClearReply,
    handles = [],
  }: {
    onSend: (text: string, replyToId?: string | null) => void;
    replyTo?: any;
    onClearReply?: () => void;
    handles?: { handle: string; name: string }[];
  } = $props();

  let text = $state('');
  let isFocused = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);

  // @ mention autocomplete
  let mentionQuery = $state('');
  let showMentions = $state(false);
  let mentionStart = $state(-1);
  let mentionSelectedIdx = $state(0);

  const filteredHandles = $derived(
    handles.filter(h => h.handle.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
  );

  // When replyTo changes, prepend @mention and focus
  $effect(() => {
    if (replyTo) {
      const mention = replyTo.sender_id ? `${replyTo.sender_id} ` : '';
      text = mention;
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  function detectMention() {
    const cursorPos = inputEl?.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch && handles.length > 0) {
      mentionStart = cursorPos - atMatch[0].length;
      mentionQuery = atMatch[1];
      mentionSelectedIdx = 0;
      showMentions = filteredHandles.length > 0;
    } else {
      showMentions = false;
      mentionStart = -1;
    }
  }

  function selectMention(handle: string) {
    const cursorPos = inputEl?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart);
    const after = text.slice(cursorPos);
    text = before + handle + ' ' + after;
    showMentions = false;
    mentionStart = -1;
    setTimeout(() => {
      inputEl?.focus();
      const pos = (before + handle + ' ').length;
      inputEl?.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, replyTo?.id ?? null);
    text = '';
    showMentions = false;
    onClearReply?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showMentions && filteredHandles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionSelectedIdx = Math.min(mentionSelectedIdx + 1, filteredHandles.length - 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); mentionSelectedIdx = Math.max(mentionSelectedIdx - 1, 0); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectMention(filteredHandles[mentionSelectedIdx].handle);
        return;
      }
      if (e.key === 'Escape') { showMentions = false; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && replyTo) {
      onClearReply?.();
    }
  }
</script>

<div class="relative px-4 py-3 border-t border-[var(--border-light)] bg-[#0A1628]/50 backdrop-blur-sm">
  <!-- @ mention dropdown -->
  {#if showMentions && filteredHandles.length > 0}
    <div class="absolute bottom-full left-4 right-4 mb-1 rounded-lg border overflow-hidden shadow-lg z-10"
         style="background:var(--bg-card);border-color:#6366F155;">
      {#each filteredHandles as h, i}
        <button
          onmousedown={(e) => { e.preventDefault(); selectMention(h.handle); }}
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left"
          style={i === mentionSelectedIdx ? 'background:#6366F122;' : 'background:transparent;'}
        >
          <span class="font-mono font-semibold" style="color:#6366F1;">{h.handle}</span>
          <span style="color:var(--text-muted);">{h.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Reply preview banner -->
  {#if replyTo}
    <div class="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-[#1A1A22] border border-[#6366F133] text-xs">
      <svg class="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
      </svg>
      <span class="text-gray-400">Replying to</span>
      <span class="font-mono text-[#6366F1]">{replyTo.sender_id ?? (replyTo.role === 'assistant' ? 'Assistant' : 'You')}</span>
      <span class="text-gray-600 truncate flex-1">{replyTo.content.slice(0, 60)}</span>
      <button onclick={onClearReply} class="text-gray-600 hover:text-gray-400 flex-shrink-0 ml-auto">✕</button>
    </div>
  {/if}

  <div
    class="flex items-end gap-3 px-4 py-2.5 rounded-lg bg-[#1A1A22] border border-[var(--border-subtle)] transition-all duration-200"
    class:border-[#6366F1]={isFocused}
    style={isFocused ? 'box-shadow: 0 0 20px rgba(99, 102, 241, 0.2)' : ''}
  >
    <textarea
      bind:this={inputEl}
      placeholder="Send a message… (@ to mention)"
      bind:value={text}
      oninput={detectMention}
      onfocus={() => (isFocused = true)}
      onblur={() => (isFocused = false)}
      onkeydown={handleKeydown}
      class="flex-1 bg-transparent outline-none text-sm text-white placeholder-gray-500 resize-none min-h-[40px] max-h-[120px] leading-relaxed"
      rows="1"
    ></textarea>

    <button
      onclick={handleSubmit}
      disabled={!text.trim()}
      class="w-9 h-9 rounded-full bg-gradient-indigo hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white flex-shrink-0 transition-all duration-200"
      title="Send (Enter)"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
      </svg>
    </button>
  </div>
</div>
