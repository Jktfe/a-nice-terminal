<script lang="ts">
  let { sessionId, sessionType }: { sessionId: string; sessionType: string } = $props();
  let copied = $state(false);
  let showPanel = $state(false);
  let commands = $state<Record<string, string>>({});
  let isLoading = $state(false);

  async function loadCommands() {
    if (isLoading) return;
    isLoading = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`);
      const data = await res.json();
      commands = data.commands;
      showPanel = !showPanel;
    } catch (error) {
      console.error('Failed to load share commands:', error);
    } finally {
      isLoading = false;
    }
  }

  async function copyCommand(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cmd; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="relative">
  <button
    onclick={loadCommands}
    disabled={isLoading}
    class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    style="background:var(--bg-card);color:var(--text-muted);border-color:var(--border-subtle);"
    title="Share session with agents"
  >
    {#if isLoading}
      <svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    {:else}
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C9.539 14.197 11.675 16.333 16.5 20M8.684 13.342l3.879-3.879m0 0c.46-.46 1.209-.46 1.669 0l5.16 5.16m-7.909 2.21l3.879-3.879M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
      </svg>
    {/if}
    <span>{copied ? '✓ Copied!' : 'Share'}</span>
  </button>

  {#if showPanel}
    <div class="absolute top-12 right-0 z-50 w-96 rounded-xl shadow-2xl border p-5 space-y-4 animate-slide-in" style="background:var(--bg-card);border-color:var(--border-light);">
      <div>
        <h3 class="text-sm font-semibold text-white">Share with Agents</h3>
        <p class="text-xs text-gray-400 mt-1">
          Copy a command to allow any agent to join this session.
        </p>
      </div>

      {#if Object.keys(commands).length === 0}
        <div class="py-6 text-center">
          <p class="text-sm text-gray-400">No share commands available</p>
        </div>
      {:else}
        <div class="space-y-3 max-h-96 overflow-y-auto">
          {#each Object.entries(commands) as [label, cmd]}
            <div class="space-y-2">
              <p class="text-xs font-medium text-gray-300 capitalize flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-[#6366F1]"></span>
                {label.replace(/_/g, ' ')}
              </p>
              <button
                onclick={() => copyCommand(cmd)}
                class="w-full text-left px-3 py-2.5 rounded-lg bg-[#0D0D12] font-mono text-xs text-gray-300 hover:bg-[#16161A] hover:text-[#6366F1] border border-[var(--border-subtle)] transition-all truncate"
                title={cmd}
              >
                {cmd}
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <button
        onclick={() => (showPanel = false)}
        class="w-full text-center text-xs text-gray-500 hover:text-gray-300 py-2 transition-colors"
      >
        Close
      </button>
    </div>
  {/if}
</div>
