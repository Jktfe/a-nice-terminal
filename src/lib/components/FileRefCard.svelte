<script lang="ts">
  let { ref, sessionId, onRemoved } = $props<{
    ref: any;
    sessionId: string;
    onRemoved: (id: string) => void;
  }>();

  let busy = $state(false);

  async function remove() {
    busy = true;
    try {
      await fetch(`/api/sessions/${sessionId}/file-refs?refId=${ref.id}`, { method: 'DELETE' });
      onRemoved(ref.id);
    } finally {
      busy = false;
    }
  }

  // Show just filename + parent dir for compact display
  const shortPath = $derived.by(() => {
    const parts = (ref.file_path || '').split('/');
    return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : ref.file_path;
  });
</script>

<div class="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs group"
     style="background: var(--bg-card); border-color: var(--border-subtle);">
  <!-- File icon -->
  <span class="text-green-400 mt-0.5 flex-shrink-0">⬡</span>

  <div class="flex-1 min-w-0">
    <p class="font-mono text-green-400 truncate" title={ref.file_path}>{shortPath}</p>
    {#if ref.note}
      <p class="mt-0.5" style="color: var(--text-muted);">{ref.note}</p>
    {/if}
    {#if ref.flagged_by}
      <p class="mt-0.5 font-mono" style="color: var(--text-faint);">{ref.flagged_by}</p>
    {/if}
  </div>

  <button
    onclick={remove}
    disabled={busy}
    class="flex-shrink-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all disabled:opacity-20"
    title="Remove file reference"
  >×</button>
</div>
