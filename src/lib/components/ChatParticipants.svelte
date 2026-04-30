<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
    attention_state?: string | null;
    attention_reason?: string | null;
    attention_set_by?: string | null;
    attention_expires_at?: number | null;
    focus_queue_count?: number | null;
    meta?: string | Record<string, unknown> | null;
  }

  interface Props {
    sessionId: string;
    participantsActive: { sess: PageSession; count: number; active: boolean }[];
    participantsAvailable: { sess: PageSession; count: number; active: boolean }[];
    onWakeParticipant: (sess: PageSession) => void;
    onSaveNickname: (sess: PageSession, handle: string) => void;
    onCrossPost: (targetId: string, text: string) => void;
    onRemoveParticipant?: (sess: PageSession) => void;
    onFocusParticipant?: (sess: PageSession) => void;
    onOpenLinkedChat?: (sess: PageSession) => void;
  }

  const {
    sessionId,
    participantsActive,
    participantsAvailable,
    onWakeParticipant,
    onSaveNickname,
    onCrossPost,
    onRemoveParticipant,
    onFocusParticipant,
    onOpenLinkedChat
  }: Props = $props();

  let presence = $state<Record<string, { status: 'active' | 'idle' | 'offline' }>>({});
  let pollTimer: ReturnType<typeof setInterval>;

  async function fetchPresence() {
    try {
      const res = await fetch(`/api/presence/${sessionId}`);
      const data = await res.json();
      presence = data.presence || {};
    } catch (e) {
      console.error('[ChatParticipants] failed to fetch presence:', e);
    }
  }

  onMount(() => {
    fetchPresence();
    pollTimer = setInterval(fetchPresence, 10000);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
  });

  function getStatusColor(handle: string | undefined): string {
    if (!handle) return '#9CA3AF'; // grey
    const status = presence[handle]?.status;
    if (status === 'active') return '#22C55E'; // green
    if (status === 'idle') return '#F59E0B';   // yellow
    return '#9CA3AF';                          // grey
  }

  function handleColour(h: string): string {
    if (h === 'claude' || h?.includes('claude')) return '#4F46E5';
    if (h === 'gemini' || h?.includes('gemini')) return '#10B981';
    const palette = ['#6366F1', '#22C55E', '#F59E0B', '#EC4899', '#26A69A', '#AB47BC', '#42A5F5', '#F97316'];
    let hash = 0;
    for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) & 0xffffffff;
    return palette[Math.abs(hash) % palette.length];
  }

  function participantDot(sess: PageSession): string {
    const name = (sess.display_name || sess.name || '').toLowerCase();
    if (name.includes('claude')) return '#4F46E5';
    if (name.includes('gemini')) return '#10B981';
    return handleColour(sess.id);
  }

  let editingNickname = $state<string | null>(null);
  let nicknameInput = $state('');
  let crossPostTarget = $state<string | null>(null);
  let crossPostText = $state('');
  let otherSessionsOpen = $state(false);

  function handleSaveNickname(sess: PageSession) {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { editingNickname = null; return; }
    onSaveNickname(sess, trimmed);
    editingNickname = null;
  }

  function handleCrossPost(targetId: string) {
    if (!crossPostText.trim()) return;
    onCrossPost(targetId, crossPostText.trim());
    crossPostText = '';
    crossPostTarget = null;
  }

  function cliLabel(flag: string | null | undefined): string {
    if (!flag) return '';
    const labels: Record<string, string> = {
      claude: 'Claude',
      gemini: 'Gemini',
      copilot: 'Copilot',
      aider: 'Aider',
      cursor: 'Cursor',
      codex: 'Codex',
    };
    return labels[flag] || flag;
  }

  function getCliFlag(sess: PageSession): string | null {
    try {
      const meta = typeof sess.meta === 'string' ? JSON.parse(sess.meta as string) : (sess.meta || {});
      return (meta as Record<string, string>).cli_flag || (meta as Record<string, string>).cliFlag || null;
    } catch { return null; }
  }

  function focusMinutesLeft(sess: PageSession): string {
    if (sess.attention_state !== 'focus' || !sess.attention_expires_at) return '';
    const secs = Math.max(0, Math.round(sess.attention_expires_at - Date.now() / 1000));
    return `${Math.ceil(secs / 60)}m`;
  }
</script>

<div class="px-3 pb-3 space-y-1.5">
  <!-- Active participants -->
  {#each participantsActive as p}
    {@const col = participantDot(p.sess)}
    {@const label = p.sess.display_name || p.sess.name}
    {@const flag = getCliFlag(p.sess)}
    {@const statusCol = getStatusColor(p.sess.handle)}
    <div class="rounded-lg overflow-hidden" style="border: 1px solid #E5E7EB;">
      <div class="flex items-center gap-2.5 px-2.5 py-2">
        {#if p.sess.linked_chat_id && onOpenLinkedChat}
          <button
            class="relative flex-shrink-0 p-1 -m-1 rounded"
            onclick={() => onOpenLinkedChat(p.sess)}
            title="Open linked chat for {label}"
            aria-label="Open linked chat for {label}"
            style="background: transparent; border: 0;"
          >
            <span class="w-2.5 h-2.5 rounded-full block" style="background: {col};"></span>
            <span class="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white" style="background: {statusCol};"></span>
          </button>
        {:else}
          <div class="relative flex-shrink-0">
            <span class="w-2.5 h-2.5 rounded-full block" style="background: {col};"></span>
            <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white" style="background: {statusCol};"></span>
          </div>
        {/if}
        <div class="min-w-0 flex-1">
          {#if editingNickname === p.sess.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              autofocus
              class="w-full text-xs rounded px-1.5 py-0.5 outline-none"
              style="border: 1px solid #6366F1; color: var(--text); background: var(--bg);"
              bind:value={nicknameInput}
              onkeydown={(e) => {
                if (e.key === 'Enter') handleSaveNickname(p.sess);
                if (e.key === 'Escape') editingNickname = null;
              }}
              onblur={() => handleSaveNickname(p.sess)}
            />
          {:else}
            <div class="flex items-center gap-1">
              <p class="text-xs font-semibold truncate" style="color: var(--text);">{label}</p>
            {#if flag}
                <span class="text-[9px] px-1 py-0.5 rounded font-mono flex-shrink-0" style="background: {col}15; color: {col};">{cliLabel(flag)}</span>
              {/if}
              {#if p.sess.attention_state === 'focus'}
                <span
                  class="text-[9px] px-1 py-0.5 rounded font-mono flex-shrink-0"
                  style="background: #FEF3C7; color: #92400E;"
                  title={p.sess.attention_reason || 'Focus mode'}
                >
                  FOCUS {focusMinutesLeft(p.sess)}
                </span>
              {/if}
            </div>
            {#if p.sess.handle}
              <p class="text-[10px] font-mono" style="color: {col}88;">{p.sess.handle}</p>
            {/if}
            {#if p.sess.attention_state === 'focus'}
              <p class="text-[10px] truncate" style="color: #92400E;">
                {p.sess.focus_queue_count || 0} queued{p.sess.attention_reason ? ` · ${p.sess.attention_reason}` : ''}
              </p>
            {/if}
          {/if}
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button
            onclick={() => { editingNickname = p.sess.id; nicknameInput = p.sess.handle || ''; }}
            class="p-1 rounded transition-all"
            style="color: var(--text-faint);"
            title="Set handle"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z"/>
            </svg>
          </button>
          {#if p.sess.type === 'terminal' && p.sess.handle}
            <button
              onclick={() => onWakeParticipant(p.sess)}
              class="p-1 rounded transition-all"
              style="color: var(--text-faint);"
              title="Wake"
            >📢</button>
          {/if}
          {#if p.sess.type === 'terminal' && onFocusParticipant}
            <button
              onclick={() => onFocusParticipant?.(p.sess)}
              class="p-1 rounded transition-all"
              style="color: {p.sess.attention_state === 'focus' ? '#92400E' : 'var(--text-faint)'};"
              title={p.sess.attention_state === 'focus' ? 'Exit focus mode' : 'Enter focus mode'}
              aria-label={p.sess.attention_state === 'focus' ? `Exit focus mode for ${label}` : `Enter focus mode for ${label}`}
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.1-5.1l-2.1 2.1M9 15l-2.1 2.1m0-10.2L9 9m6 6l2.1 2.1"/>
              </svg>
            </button>
          {/if}
          {#if p.sess.type !== 'external'}
            <button
              onclick={() => onRemoveParticipant?.(p.sess)}
              class="p-1 rounded transition-all"
              style="color: var(--text-faint);"
              title="Remove from room"
              aria-label="Remove {label} from room"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>
      <!-- Post to X row -->
      <button
        onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
        class="w-full flex items-center justify-between px-2.5 py-1.5 text-xs transition-colors"
        style="border-top: 1px solid #F3F4F6; color: #6366F1; background: {crossPostTarget === p.sess.id ? '#EEF2FF' : '#FAFAFA'};"
        title="Post to {label}"
      >
        <em>Post to {label}</em>
        <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
      </button>
      {#if crossPostTarget === p.sess.id}
        <div class="px-2.5 pb-2.5 pt-1.5" style="background: #F9FAFB;">
          <div class="flex gap-1.5">
            <input
              class="flex-1 text-xs rounded-lg px-2.5 py-1.5 outline-none"
              style="border: 1px solid #6366F1; color: var(--text); background: var(--bg);"
              placeholder="Message to {label}…"
              bind:value={crossPostText}
              onkeydown={(e) => { if (e.key === 'Enter') handleCrossPost(p.sess.id); if (e.key === 'Escape') crossPostTarget = null; }}
            />
            <button
              onclick={() => handleCrossPost(p.sess.id)}
              class="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center"
              style="background: #6366F1; color: #fff;"
              aria-label="Send"
              title="Send"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <!-- Available (not yet posted) sessions -->
  {#if participantsAvailable.length > 0}
    <div class="rounded-lg overflow-hidden" style="border: 1px solid #E5E7EB; background: #FAFAFA;">
      <button
        onclick={() => (otherSessionsOpen = !otherSessionsOpen)}
        class="w-full flex items-center justify-between px-2.5 py-2 text-xs transition-colors"
        style="color: var(--text-muted);"
      >
        <span class="font-semibold uppercase tracking-wide">Other sessions</span>
        <span class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style="background: #fff; color: var(--text-faint);">
            {participantsAvailable.length}
          </span>
          <svg
            class="w-3.5 h-3.5 transition-transform"
            style="color: var(--text-faint); transform: {otherSessionsOpen ? 'rotate(180deg)' : 'rotate(0deg)'};"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </span>
      </button>
      {#if otherSessionsOpen}
        <div class="px-2.5 pb-2.5 space-y-1.5" style="border-top: 1px solid #F3F4F6;">
          {#each participantsAvailable as p}
            {@const col = participantDot(p.sess)}
            {@const label = p.sess.display_name || p.sess.name}
            <div class="rounded-lg overflow-hidden opacity-80" style="border: 1px solid #E5E7EB; background: var(--bg);">
              <div class="flex items-center gap-2.5 px-2.5 py-2">
                {#if p.sess.linked_chat_id && onOpenLinkedChat}
                  <button
                    class="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    onclick={() => onOpenLinkedChat(p.sess)}
                    title="Open linked chat for {label}"
                    aria-label="Open linked chat for {label}"
                    style="background: transparent; border: 0;"
                  >
                    <span class="w-2.5 h-2.5 rounded-full block" style="background: {col}88;"></span>
                  </button>
                {:else}
                  <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background: {col}88;"></span>
                {/if}
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium truncate" style="color: var(--text-muted);">{label}</p>
                  <p class="text-[10px] font-mono" style="color: var(--text-faint);">{p.sess.type}</p>
                </div>
                <div class="flex items-center gap-0.5">
                  {#if p.sess.type === 'terminal' && p.sess.handle}
                    <button onclick={() => onWakeParticipant(p.sess)} class="p-1 rounded" style="color: var(--text-faint);" title="Wake">📢</button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
