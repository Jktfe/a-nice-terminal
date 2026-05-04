<script lang="ts">
  let { onSubmit, disabled = false } = $props<{ onSubmit: (cmd: string) => void; disabled?: boolean }>();
  let text = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!inputEl) return;
    inputEl.setAttribute('autocorrect', 'off');
    inputEl.setAttribute('autocapitalize', 'off');
  });

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

<div class="cli-input-shell flex items-center gap-3 px-4">
  <span class="font-mono font-semibold text-[#22C55E]">$</span>
  <input
    bind:this={inputEl}
    type="text"
    placeholder={disabled ? 'Terminal unavailable...' : 'Type a command...'}
    bind:value={text}
    onkeydown={handleKeydown}
    autocomplete="off"
    spellcheck={false}
    {disabled}
    class="flex-1 bg-transparent outline-none font-mono text-sm text-gray-900 dark:text-white placeholder-gray-400"
  />
</div>

<style>
  .cli-input-shell {
    min-height: 52px;
    padding-left: max(16px, var(--ant-safe-left, 0px));
    padding-right: max(16px, var(--ant-safe-right, 0px));
    padding-bottom: max(0px, var(--ant-keyboard-h, 0px), var(--ant-safe-bottom, 0px));
    transition: padding-bottom var(--duration-fast) var(--spring-default);
  }
</style>
