<script lang="ts">
  import { onMount } from 'svelte';

  interface Participant { id: string; count: number; }
  interface KeyTerm { term: string; count: number; }
  interface Digest {
    messageCount: number;
    participantCount: number;
    durationMinutes: number;
    messagesPerHour: number;
    participants: Participant[];
    keyTerms: KeyTerm[];
    firstMessage: string | null;
    lastMessage: string | null;
  }

  let { sessionId, onClose }: { sessionId: string; onClose: () => void } = $props();

  let digest = $state<Digest | null>(null);
  let loading = $state(true);
  let failed = $state(false);

  onMount(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/digest`);
      if (!res.ok) throw new Error('fetch failed');
      digest = await res.json();
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  });

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function shortId(id: string): string {
    return id.length > 16 ? id.slice(0, 12) + '…' : id;
  }
</script>

<!-- Backdrop -->
<button
  class="fixed inset-0 z-40"
  style="background: rgba(0,0,0,0.35);"
  onclick={onClose}
  aria-label="Close digest"
></button>

<!-- Panel -->
<div
  class="fixed right-0 top-0 h-full z-50 flex flex-col overflow-hidden"
  style="width: min(420px, 100vw); background: var(--bg-card); border-left: 1px solid var(--border-subtle); box-shadow: -4px 0 24px rgba(0,0,0,0.15);"
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style="border-color: var(--border-subtle);">
    <div class="flex items-center gap-2">
      <svg class="w-4 h-4" style="color:#6366F1;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <span class="text-sm font-semibold" style="color: var(--text);">Session Digest</span>
    </div>
    <button onclick={onClose} class="p-1 rounded-lg transition-all" style="color: var(--text-muted);">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  </div>

  <!-- Body -->
  <div class="flex-1 overflow-y-auto p-4 space-y-5">
    {#if loading}
      <div class="flex items-center justify-center py-12" style="color: var(--text-muted);">
        <svg class="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Generating digest…
      </div>
    {:else if failed}
      <p class="text-sm text-center py-12" style="color: var(--text-muted);">Failed to load digest.</p>
    {:else if digest}

      <!-- Stats row -->
      <div class="grid grid-cols-2 gap-3">
        {#each [
          { label: 'Messages', value: digest.messageCount },
          { label: 'Participants', value: digest.participantCount },
          { label: 'Duration', value: formatDuration(digest.durationMinutes) },
          { label: 'Msgs / hr', value: digest.messagesPerHour },
        ] as stat}
          <div class="rounded-xl p-3 text-center" style="background: var(--bg); border: 1px solid var(--border-subtle);">
            <p class="text-xl font-bold" style="color:#6366F1;">{stat.value}</p>
            <p class="text-xs mt-0.5" style="color: var(--text-muted);">{stat.label}</p>
          </div>
        {/each}
      </div>

      <!-- Timeline -->
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide mb-2" style="color: var(--text-muted);">Timeline</h3>
        <div class="flex items-center gap-2 text-xs" style="color: var(--text);">
          <span class="px-2 py-1 rounded-lg" style="background: var(--bg); border: 1px solid var(--border-subtle);">
            {formatTime(digest.firstMessage)}
          </span>
          <div class="flex-1 h-px" style="background: var(--border-subtle);"></div>
          <span class="px-2 py-1 rounded-lg font-medium" style="background: rgba(99,102,241,0.1); color:#6366F1; border: 1px solid rgba(99,102,241,0.2);">
            {formatDuration(digest.durationMinutes)}
          </span>
          <div class="flex-1 h-px" style="background: var(--border-subtle);"></div>
          <span class="px-2 py-1 rounded-lg" style="background: var(--bg); border: 1px solid var(--border-subtle);">
            {formatTime(digest.lastMessage)}
          </span>
        </div>
      </div>

      <!-- Participants -->
      {#if digest.participants.length > 0}
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide mb-2" style="color: var(--text-muted);">Participants</h3>
          <div class="space-y-1.5">
            {#each digest.participants as p}
              {@const pct = Math.round((p.count / digest.messageCount) * 100)}
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono truncate flex-1" style="color: var(--text);" title={p.id}>{shortId(p.id)}</span>
                <div class="w-20 h-1.5 rounded-full overflow-hidden" style="background: var(--border-subtle);">
                  <div class="h-full rounded-full" style="width:{pct}%; background:#6366F1;"></div>
                </div>
                <span class="text-xs w-8 text-right" style="color: var(--text-muted);">{p.count}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Key terms -->
      {#if digest.keyTerms.length > 0}
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide mb-2" style="color: var(--text-muted);">Key Terms</h3>
          <div class="flex flex-wrap gap-1.5">
            {#each digest.keyTerms as { term, count }}
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                style="background: rgba(99,102,241,0.1); color:#6366F1; border: 1px solid rgba(99,102,241,0.2);"
                title="{count} occurrences"
              >{term}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if digest.messageCount === 0}
        <p class="text-sm text-center py-8" style="color: var(--text-muted);">No messages yet.</p>
      {/if}
    {/if}
  </div>
</div>
