<script lang="ts">
  let { onSubmit, disabled = false } = $props<{ onSubmit: (cmd: string) => void; disabled?: boolean }>();
  let text = $state('');

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text);
        text = '';
      }
    }
  }
</script>

<div class="flex items-center gap-3 px-4 h-[52px]">
  <span class="font-mono font-semibold text-[#22C55E]">$</span>
  <input
    type="text"
    placeholder={disabled ? 'Terminal unavailable...' : 'Type a command...'}
    bind:value={text}
    onkeydown={handleKeydown}
    {disabled}
    class="flex-1 bg-transparent outline-none font-mono text-sm text-gray-900 dark:text-white placeholder-gray-400"
  />
</div>
