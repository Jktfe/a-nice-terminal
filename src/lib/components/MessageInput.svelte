<script lang="ts">
  let { onSend } = $props<{ onSend: (text: string) => void }>();
  let text = $state('');
  let isFocused = $state(false);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    text = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="px-4 py-4 border-t border-[var(--border-light)] bg-[#0A1628]/50 backdrop-blur-sm">
  <div
    class="flex items-end gap-3 px-4 py-2.5 rounded-lg bg-[#1A1A22] border border-[var(--border-subtle)] transition-all duration-200"
    class:border-[#6366F1]={isFocused}
    class:shadow-lg={isFocused}
    style={isFocused ? 'box-shadow: 0 0 20px rgba(99, 102, 241, 0.2)' : ''}
  >
    <!-- Icon/Attachment Button -->
    <button
      title="Attach file"
      class="text-gray-500 hover:text-[#6366F1] transition-colors flex-shrink-0 p-1"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
    </button>

    <!-- Input -->
    <textarea
      placeholder="Send a message..."
      bind:value={text}
      onfocus={() => (isFocused = true)}
      onblur={() => (isFocused = false)}
      onkeydown={handleKeydown}
      class="flex-1 bg-transparent outline-none text-sm text-white placeholder-gray-500 resize-none min-h-[40px] max-h-[120px] leading-relaxed"
      rows="1"
    />

    <!-- Send Button -->
    <button
      onclick={handleSubmit}
      disabled={!text.trim()}
      class="w-9 h-9 rounded-full bg-gradient-indigo hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white text-lg flex-shrink-0 transition-all duration-200"
      title="Send message (Enter)"
    >
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.16345578 C3.34915502,0.9 2.40734225,1.00636533 1.77946707,1.4776575 C0.994623095,2.10604706 0.837654326,3.0486314 1.15159189,3.99701575 L3.03521743,10.4380088 C3.03521743,10.5951061 3.19218622,10.7522035 3.50612381,10.7522035 L16.6915026,11.5376905 C16.6915026,11.5376905 17.1624089,11.5376905 17.1624089,12.0089826 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z" />
      </svg>
    </button>
  </div>

  <!-- Quick Phrases (Optional) -->
  <div class="mt-2 flex flex-wrap gap-2">
    <button
      class="text-xs px-2 py-1 rounded-full bg-[#1A1A22] text-gray-400 hover:text-[#6366F1] hover:bg-[#24242E] transition-colors"
      onclick={() => (text = 'Can you help me with this?')}
    >
      💬 Help
    </button>
    <button
      class="text-xs px-2 py-1 rounded-full bg-[#1A1A22] text-gray-400 hover:text-[#6366F1] hover:bg-[#24242E] transition-colors"
      onclick={() => (text = 'Explain this')}
    >
      📖 Explain
    </button>
    <button
      class="text-xs px-2 py-1 rounded-full bg-[#1A1A22] text-gray-400 hover:text-[#6366F1] hover:bg-[#24242E] transition-colors"
      onclick={() => (text = 'Show me an example')}
    >
      ✨ Example
    </button>
  </div>
</div>
