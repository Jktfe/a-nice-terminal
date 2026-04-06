<script lang="ts">
  let {
    onSend,
    replyTo = null,
    onClearReply,
  }: {
    onSend: (text: string) => void;
    replyTo?: any;
    onClearReply?: () => void;
  } = $props();

  let text = $state('');
  let isFocused = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);

  // When replyTo changes, prepend @mention and focus
  $effect(() => {
    if (replyTo) {
      const mention = replyTo.sender_id ? `${replyTo.sender_id} ` : '';
      text = mention;
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    text = '';
    onClearReply?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && replyTo) {
      onClearReply?.();
    }
  }
</script>

<div class="px-4 py-3 border-t border-[var(--border-light)] bg-[#0A1628]/50 backdrop-blur-sm">
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
      <button
        onclick={onClearReply}
        class="text-gray-600 hover:text-gray-400 flex-shrink-0 ml-auto"
      >✕</button>
    </div>
  {/if}

  <div
    class="flex items-end gap-3 px-4 py-2.5 rounded-lg bg-[#1A1A22] border border-[var(--border-subtle)] transition-all duration-200"
    class:border-[#6366F1]={isFocused}
    style={isFocused ? 'box-shadow: 0 0 20px rgba(99, 102, 241, 0.2)' : ''}
  >
    <textarea
      bind:this={inputEl}
      placeholder="Send a message…"
      bind:value={text}
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
