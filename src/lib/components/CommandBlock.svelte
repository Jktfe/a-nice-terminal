<script lang="ts">
  let {
    command,
    cwd,
    exit_code,
    started_at,
    duration_ms,
    output_snippet,
  }: {
    command: string;
    cwd: string | null;
    exit_code: number | null;
    started_at: string | null;
    duration_ms: number | null;
    output_snippet: string | null;
  } = $props();

  let expanded = $state(false);

  function fmtDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  }

  function fmtCwd(path: string | null): string {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return '…/' + parts.slice(-2).join('/');
  }

  const success = $derived(exit_code === 0 || exit_code === null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="border-l-2 px-3 py-2 mb-1.5 rounded-r cursor-pointer transition-colors hover:bg-[#1A1A22]/60"
  class:border-[#22C55E]={success}
  class:border-[#EF4444]={!success}
  onclick={() => (expanded = !expanded)}
>
  <!-- Top row: command + status -->
  <div class="flex items-start justify-between gap-2 min-w-0">
    <span class="text-[#E0E0E0] font-mono text-sm leading-snug truncate flex-1 min-w-0">{command}</span>
    <div class="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
      {#if success}
        <span class="text-[#22C55E] text-xs font-bold">✓</span>
      {:else}
        <span class="text-[#EF4444] text-xs font-bold">✗ {exit_code}</span>
      {/if}
    </div>
  </div>

  <!-- Second row: CWD + duration + time -->
  <div class="flex items-center justify-between gap-2 mt-0.5">
    <div class="flex items-center gap-1.5 min-w-0">
      {#if cwd}
        <span class="text-[#6366F1] text-xs font-mono truncate">{fmtCwd(cwd)}</span>
      {/if}
    </div>
    <div class="flex items-center gap-2 text-[#78909C] text-xs flex-shrink-0">
      {#if duration_ms !== null && duration_ms !== undefined}
        <span>{fmtDuration(duration_ms)}</span>
      {/if}
      {#if started_at}
        <span>{fmtTime(started_at)}</span>
      {/if}
    </div>
  </div>

  <!-- Expanded output -->
  {#if expanded && output_snippet}
    <div class="mt-1.5 pt-1.5 border-t border-[#1A1A22]">
      <pre class="text-[#78909C] font-mono text-xs whitespace-pre-wrap leading-relaxed break-all">{output_snippet}</pre>
    </div>
  {:else if expanded && !output_snippet}
    <div class="mt-1.5 pt-1.5 border-t border-[#1A1A22]">
      <span class="text-[#78909C] text-xs italic">No output captured.</span>
    </div>
  {/if}
</div>
