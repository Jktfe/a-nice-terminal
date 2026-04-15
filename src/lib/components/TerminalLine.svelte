<script lang="ts">
  let {
    message,
    messages,
  }: {
    message?: any;
    messages?: any[];
  } = $props();

  // Normalise to an array — accept either a single message or a group
  const lines = $derived.by(() => {
    if (messages && messages.length > 0) return messages;
    if (message) return [message];
    return [];
  });

  // Timestamp from the first message in the group
  const timeStr = $derived.by(() => {
    const first = lines[0];
    if (!first?.created_at) return '';
    const utc = first.created_at.includes('Z') || first.created_at.includes('+')
      ? first.created_at
      : first.created_at.replace(' ', 'T') + 'Z';
    return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  // Terminal name / source label from sender_id or a default
  const sourceLabel = $derived(lines[0]?.sender_id || 'terminal');
</script>

<div class="group flex flex-col gap-0 w-full" style="max-width:100%;">
  <!-- Header row: source label + timestamp -->
  <div class="flex items-center gap-2 px-1 mb-0.5">
    <span class="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
          style="background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border-subtle);font-family:'JetBrains Mono',monospace;">
      {sourceLabel}
    </span>
    {#if timeStr}
      <span class="text-[10px]" style="color:var(--text-muted);">{timeStr}</span>
    {/if}
  </div>

  <!-- Code block containing all consecutive lines -->
  <div class="rounded-lg overflow-x-auto px-3 py-2"
       style="background:var(--terminal-bg);border:1px solid var(--border-subtle);font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);line-height:1.5;">
    {#each lines as line (line.id)}
      <div class="whitespace-pre-wrap break-all">{line.content}</div>
    {/each}
  </div>
</div>
