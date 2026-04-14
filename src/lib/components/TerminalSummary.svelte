<script lang="ts">
  import { onMount } from 'svelte';

  let { messages }: { messages: any[] } = $props();

  // Extract text and strip ANSI again just in case, though server usually does it
  const fullText = $derived(messages.map(m => m.content).join('\n'));

  function summarize(text: string) {
    if (!text) return '';
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length <= 6) return lines.join('\n');
    return [...lines.slice(0, 3), '...', ...lines.slice(-3)].join('\n');
  }

  const summary = $derived(summarize(fullText));
  const lineCount = $derived(fullText.split('\n').length);
</script>

<div class="my-2 px-3 py-2 rounded-lg border text-[11px] leading-relaxed group relative"
     style="background:rgba(0,0,0,0.2); border-color:var(--border-subtle); color:var(--text-muted); font-family:'JetBrains Mono', monospace;">
  <div class="absolute -top-2 left-3 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
       style="background:var(--bg); border:1px solid var(--border-subtle);">
    Terminal Output ({lineCount} lines)
  </div>
  <pre class="whitespace-pre-wrap break-all opacity-80">{summary}</pre>
</div>
