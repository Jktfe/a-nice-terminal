<script>
  /** @type {{ code: string, language?: string, showChrome?: boolean }} */
  let { code, language = '', showChrome = true } = $props();

  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-surface)]">
  {#if showChrome}
    <div class="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
      <div class="flex items-center gap-2">
        <div class="h-3 w-3 rounded-full bg-red-500/60"></div>
        <div class="h-3 w-3 rounded-full bg-yellow-500/60"></div>
        <div class="h-3 w-3 rounded-full bg-green-500/60"></div>
        {#if language}
          <span class="ml-2 text-xs text-neutral-500">{language}</span>
        {/if}
      </div>
      <button
        onclick={copy}
        class="cursor-pointer rounded px-2 py-1 text-xs transition-colors {copied ? 'text-emerald-400' : 'text-neutral-600 hover:text-neutral-400'}"
      >
        {copied ? 'copied!' : 'copy'}
      </button>
    </div>
  {/if}
  <div class="relative">
    {#if !showChrome}
      <button
        onclick={copy}
        class="absolute right-3 top-3 cursor-pointer rounded px-2 py-1 text-xs transition-colors {copied ? 'text-emerald-400' : 'text-neutral-600 hover:text-neutral-400'}"
      >
        {copied ? 'copied!' : 'copy'}
      </button>
    {/if}
    <pre class="overflow-x-auto bg-black/40 p-5 text-sm leading-relaxed"><code class="text-neutral-300">{code}</code></pre>
  </div>
</div>
