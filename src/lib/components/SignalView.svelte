<script lang="ts">
  import { classifyBatch, type Signal } from '$lib/utils/signals';

  let { lines = [] }: { lines: string[] } = $props();

  const signals = $derived(classifyBatch(lines));
</script>

<div class="flex-1 overflow-y-auto p-4 space-y-1">
  {#each signals as signal, i}
    {#if signal.type === 'error'}
      <div class="flex items-start gap-2 px-3 py-1.5 rounded bg-red-500/10 border-l-2 border-red-500">
        <span class="text-red-400 text-xs mt-0.5">✗</span>
        <span class="font-mono text-xs text-red-400">{signal.message}</span>
      </div>
    {:else if signal.type === 'success'}
      <div class="flex items-start gap-2 px-3 py-1.5">
        <span class="text-green-400 text-xs mt-0.5">✓</span>
        <span class="font-mono text-xs text-green-400">{signal.message}</span>
      </div>
    {:else if signal.type === 'prompt'}
      <div class="px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30">
        <div class="flex items-center gap-2">
          <span class="text-amber-400 text-xs">⚠</span>
          <span class="font-mono text-xs text-white">{signal.message}</span>
        </div>
        {#if signal.options.length > 0}
          <div class="flex gap-2 mt-2">
            {#each signal.options as opt}
              <button class="px-3 py-1 text-xs font-medium rounded-full {opt === 'y' || opt === 'yes' ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}">
                {opt}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if signal.type === 'collapsed'}
      <button class="flex items-center gap-2 px-3 py-1 text-gray-500 hover:text-gray-300 text-xs">
        <span>▶</span>
        <span class="font-mono">{signal.lineCount} lines — {signal.summary}</span>
      </button>
    {:else if signal.message}
      <div class="px-3 py-0.5">
        <span class="font-mono text-xs text-gray-400">{signal.message}</span>
      </div>
    {/if}
  {/each}
</div>
