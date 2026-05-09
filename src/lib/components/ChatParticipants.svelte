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
    /** @deprecated Wake removed from UI — cross-post composer covers the same use case with arbitrary text. */
    onWakeParticipant?: (sess: PageSession) => void;
    onSaveNickname: (sess: PageSession, handle: string) => void;
    onCrossPost: (targetId: string, text: string) => void;
    onRemoveParticipant?: (sess: PageSession) => void;
    onFocusParticipant?: (sess: PageSession) => void;
    onOpenLinkedChat?: (sess: PageSession) => void;
    onAddTerminalToRoom?: (sess: PageSession) => void;
    onStopParticipant?: (sess: PageSession) => void;
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
    onOpenLinkedChat,
    onAddTerminalToRoom,
    onStopParticipant,
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
    if (!handle) return '#9CA3AF';
    const status = presence[handle]?.status;
    if (status === 'active') return '#22C55E';
    if (status === 'idle') return '#F59E0B';
    return '#9CA3AF';
  }

  function getStatusLabel(handle: string | undefined): string {
    if (!handle) return 'unknown';
    return presence[handle]?.status || 'offline';
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

  // Edge-band opacity is modulated by presence so the colour stays
  // consistent (so you can identify the agent at a glance) but its
  // saturation telegraphs whether they're alive right now.
  function edgeOpacity(handle: string | undefined): number {
    if (!handle) return 0.35;
    const s = presence[handle]?.status;
    if (s === 'active') return 1;
    if (s === 'idle') return 0.55;
    return 0.3;
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

<div class="participant-strip">
  {#each participantsActive as p}
    {@const col = participantDot(p.sess)}
    {@const label = p.sess.display_name || p.sess.name}
    {@const flag = getCliFlag(p.sess)}
    {@const statusCol = getStatusColor(p.sess.handle)}
    {@const statusLabel = getStatusLabel(p.sess.handle)}
    {@const isFocus = p.sess.attention_state === 'focus'}

    <div
      class="participant-card"
      class:is-focus={isFocus}
      style="--participant-color: {col}; --edge-opacity: {edgeOpacity(p.sess.handle)};"
    >
      <span class="edge" aria-hidden="true"></span>

      <div class="card-body">
        <div class="identity">
          <div class="name-line">
            <span class="name">{label}</span>
            {#if flag}
              <span class="chip chip--cli">{cliLabel(flag)}</span>
            {/if}
            {#if isFocus}
              <span class="chip chip--focus" title={p.sess.attention_reason || 'Focus mode'}>
                FOCUS{focusMinutesLeft(p.sess) ? ' ' + focusMinutesLeft(p.sess) : ''}
              </span>
            {/if}
          </div>
          <div class="meta-line">
            <span class="status-dot" style="background: {statusCol};" aria-hidden="true"></span>
            <span class="status-label">{statusLabel}</span>
            {#if p.sess.handle}
              <span class="meta-sep">·</span>
              <span class="handle">{p.sess.handle}</span>
            {/if}
            {#if isFocus && p.sess.focus_queue_count}
              <span class="meta-sep">·</span>
              <span class="queued">{p.sess.focus_queue_count} queued</span>
            {/if}
          </div>
        </div>

        <div class="actions">
          <button
            class="icon-btn icon-btn--primary"
            onclick={() => { crossPostTarget = crossPostTarget === p.sess.id ? null : p.sess.id; crossPostText = ''; }}
            class:is-active={crossPostTarget === p.sess.id}
            title="Send a message to {label}"
            aria-label="Send a message to {label}"
            aria-expanded={crossPostTarget === p.sess.id}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>

          <div class="actions-overflow">
            <button
              class="icon-btn"
              class:is-active={editingNickname === p.sess.id}
              onclick={() => {
                if (editingNickname === p.sess.id) {
                  editingNickname = null;
                } else {
                  editingNickname = p.sess.id;
                  nicknameInput = p.sess.handle || '';
                }
              }}
              title="Set handle for {label}"
              aria-label="Set handle for {label}"
              aria-expanded={editingNickname === p.sess.id}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z"/>
              </svg>
            </button>

            {#if p.sess.type === 'terminal' && onFocusParticipant}
              <button
                class="icon-btn"
                class:is-focus-active={isFocus}
                onclick={() => onFocusParticipant?.(p.sess)}
                title={isFocus ? `Exit focus mode for ${label}` : `Enter focus mode for ${label}`}
                aria-label={isFocus ? `Exit focus mode for ${label}` : `Enter focus mode for ${label}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <circle cx="12" cy="12" r="5"/>
                  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                </svg>
              </button>
            {/if}

            {#if p.sess.type === 'terminal' && onStopParticipant}
              <button
                class="icon-btn icon-btn--stop"
                onclick={() => onStopParticipant?.(p.sess)}
                title="Stop current action for {label}"
                aria-label="Stop current action for {label}"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                </svg>
              </button>
            {/if}

            {#if p.sess.type !== 'external'}
              <button
                class="icon-btn icon-btn--danger"
                onclick={() => onRemoveParticipant?.(p.sess)}
                title="Remove {label} from room"
                aria-label="Remove {label} from room"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            {/if}
          </div>
        </div>

        {#if editingNickname === p.sess.id}
          <div class="composer composer--rename">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="composer-input"
              placeholder="@handle (e.g. @vera)"
              bind:value={nicknameInput}
              onkeydown={(e) => {
                if (e.key === 'Enter') handleSaveNickname(p.sess);
                if (e.key === 'Escape') editingNickname = null;
              }}
              autofocus
            />
            <button
              class="composer-send"
              onclick={() => handleSaveNickname(p.sess)}
              aria-label="Save handle"
              title="Save handle"
              disabled={!nicknameInput.trim()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12l5 5L20 7"/>
              </svg>
            </button>
          </div>
        {/if}

        {#if crossPostTarget === p.sess.id}
          <div class="composer">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="composer-input"
              placeholder="Message to {label}…"
              bind:value={crossPostText}
              onkeydown={(e) => { if (e.key === 'Enter') handleCrossPost(p.sess.id); if (e.key === 'Escape') crossPostTarget = null; }}
              autofocus
            />
            <button
              class="composer-send"
              onclick={() => handleCrossPost(p.sess.id)}
              aria-label="Send"
              title="Send"
              disabled={!crossPostText.trim()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/each}

  {#if participantsAvailable.length > 0}
    <div class="available-section">
      <button
        class="available-toggle"
        onclick={() => (otherSessionsOpen = !otherSessionsOpen)}
        aria-expanded={otherSessionsOpen}
      >
        <span>Other terminals</span>
        <span class="available-toggle-right">
          <span class="count-pill">{participantsAvailable.length}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            class="chevron"
            class:chevron--open={otherSessionsOpen}
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </span>
      </button>
      {#if otherSessionsOpen}
        <div class="available-list">
          {#each participantsAvailable as p}
            {@const col = participantDot(p.sess)}
            {@const label = p.sess.display_name || p.sess.name}
            {@const aFlag = getCliFlag(p.sess)}
            <div
              class="participant-card participant-card--ghost"
              style="--participant-color: {col}; --edge-opacity: 0.4;"
            >
              <span class="edge" aria-hidden="true"></span>
              <div class="card-body">
                <div class="identity">
                  <div class="name-line">
                    <span class="name name--muted">{label}</span>
                    {#if aFlag}
                      <span class="chip chip--cli">{cliLabel(aFlag)}</span>
                    {/if}
                  </div>
                  {#if p.sess.handle}
                    <div class="meta-line">
                      <span class="handle">{p.sess.handle}</span>
                    </div>
                  {/if}
                </div>
                <div class="actions">
                  {#if p.sess.linked_chat_id && onOpenLinkedChat}
                    <button
                      class="icon-btn icon-btn--primary"
                      onclick={() => onOpenLinkedChat?.(p.sess)}
                      title="Open linked chat for {label}"
                      aria-label="Open linked chat for {label}"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6"/>
                      </svg>
                    </button>
                  {/if}
                  {#if onAddTerminalToRoom}
                    <button
                      class="icon-btn icon-btn--primary"
                      onclick={() => onAddTerminalToRoom?.(p.sess)}
                      title="Send join command to {label}"
                      aria-label="Send join command to {label}"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                    </button>
                  {/if}
                  {#if onStopParticipant}
                    <button
                      class="icon-btn icon-btn--stop"
                      onclick={() => onStopParticipant?.(p.sess)}
                      title="Stop current action for {label}"
                      aria-label="Stop current action for {label}"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                      </svg>
                    </button>
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

<style>
  .participant-strip {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 12px;
  }

  /* ── Participant card ─────────────────────────────────────────── */
  .participant-card {
    position: relative;
    display: flex;
    align-items: stretch;
    background: var(--bg-surface, #ffffff);
    border: 1px solid var(--border-subtle, #E5E7EB);
    border-radius: 8px;
    overflow: hidden;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }

  .participant-card:hover {
    border-color: var(--border-light, #D1D5DB);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .participant-card.is-focus {
    border-color: color-mix(in srgb, #F59E0B 35%, var(--border-subtle, #E5E7EB));
    box-shadow: 0 0 0 1px color-mix(in srgb, #F59E0B 18%, transparent);
  }

  /* The edge band: 3px coloured spine on the left.
     Replaces the disconnected disc + presence-dot pattern. Saturation
     conveys presence (--edge-opacity). Colour conveys identity. */
  .edge {
    flex: 0 0 3px;
    background: var(--participant-color, #6366F1);
    opacity: var(--edge-opacity, 0.85);
    transition: opacity 0.2s ease;
  }

  .participant-card:hover .edge {
    opacity: 1;
  }

  /* ── Card body ────────────────────────────────────────────────── */
  .card-body {
    flex: 1;
    min-width: 0;
    padding: 9px 10px 9px 11px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  /* Composer occupies full width when present */
  .card-body :global(.composer) {
    grid-column: 1 / -1;
  }

  .identity {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text, #111);
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.005em;
  }

  .name--muted {
    color: var(--text-muted, #6B7280);
    font-weight: 500;
  }

  .meta-line {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-faint, #9CA3AF);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  .meta-sep {
    opacity: 0.5;
  }

  .handle {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    color: var(--participant-color, #6366F1);
    opacity: 0.85;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-label {
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }

  .queued {
    color: #92400E;
    font-weight: 500;
  }

  .chip {
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    padding: 1px 6px;
    border-radius: 3px;
    line-height: 1.5;
    flex-shrink: 0;
  }

  .chip--cli {
    background: color-mix(in srgb, var(--participant-color, #6366F1) 12%, transparent);
    color: var(--participant-color, #6366F1);
  }

  .chip--focus {
    background: #FEF3C7;
    color: #92400E;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 9px;
  }

  /* ── Actions: two-tier reveal ─────────────────────────────────── */
  .actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .actions-overflow {
    display: flex;
    align-items: center;
    gap: 1px;
    margin-left: 4px;
    padding-left: 4px;
    border-left: 1px solid var(--border-subtle, #E5E7EB);
    max-width: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-width 0.2s ease, opacity 0.15s ease, padding 0.2s ease, margin 0.2s ease;
  }

  .participant-card:hover .actions-overflow,
  .participant-card:focus-within .actions-overflow {
    max-width: 200px;
    opacity: 1;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--text-faint, #9CA3AF);
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease, transform 0.08s ease;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, #6366F1 9%, transparent);
    color: var(--text, #111);
  }

  .icon-btn:active {
    transform: scale(0.94);
  }

  .icon-btn:focus-visible {
    outline: 2px solid #6366F1;
    outline-offset: 1px;
  }

  @media (hover: none), (pointer: coarse) {
    .actions-overflow {
      max-width: 220px;
      opacity: 1;
    }

    .icon-btn {
      width: 36px;
      height: 36px;
    }
  }

  .icon-btn--primary {
    color: var(--participant-color, #6366F1);
  }

  .icon-btn--primary:hover {
    background: color-mix(in srgb, var(--participant-color, #6366F1) 12%, transparent);
    color: var(--participant-color, #6366F1);
  }

  .icon-btn--primary.is-active {
    background: color-mix(in srgb, var(--participant-color, #6366F1) 14%, transparent);
    color: var(--participant-color, #6366F1);
  }

  /* The Stop button signals "this kills the running operation" — solid red
     at rest because it's the most consequential action in the strip and
     should be unmistakable when it appears (it's already gated behind the
     hover-only secondary reveal, so it doesn't scream at rest). */
  .icon-btn--stop {
    color: #DC2626;
  }

  .icon-btn--stop:hover {
    background: color-mix(in srgb, #DC2626 14%, transparent);
    color: #B91C1C;
  }

  .icon-btn--danger {
    color: var(--text-faint, #9CA3AF);
  }

  .icon-btn--danger:hover {
    background: color-mix(in srgb, #EF4444 12%, transparent);
    color: #DC2626;
  }

  .icon-btn.is-focus-active {
    color: #92400E;
    background: color-mix(in srgb, #F59E0B 14%, transparent);
  }

  /* ── Inline composer ──────────────────────────────────────────── */
  .composer {
    grid-column: 1 / -1;
    display: flex;
    gap: 6px;
    padding-top: 8px;
    margin-top: 6px;
    border-top: 1px solid var(--border-subtle, #E5E7EB);
  }

  .composer-input {
    flex: 1;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle, #E5E7EB);
    background: var(--bg, #fff);
    color: var(--text);
    outline: none;
    transition: border-color 0.12s ease;
  }

  .composer-input:focus {
    border-color: #6366F1;
    box-shadow: 0 0 0 3px color-mix(in srgb, #6366F1 12%, transparent);
  }

  .composer-send {
    padding: 0 10px;
    border-radius: 6px;
    background: #6366F1;
    color: white;
    border: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.12s ease, transform 0.08s ease;
  }

  .composer-send:hover:not(:disabled) {
    background: #4F46E5;
  }

  .composer-send:active:not(:disabled) {
    transform: scale(0.96);
  }

  .composer-send:disabled {
    background: var(--border-subtle, #E5E7EB);
    color: var(--text-faint, #9CA3AF);
    cursor: not-allowed;
  }

  /* ── Available (other sessions) ──────────────────────────────── */
  .available-section {
    margin-top: 6px;
    border: 1px dashed var(--border-subtle, #E5E7EB);
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-card, #F9FAFB) 50%, transparent);
  }

  .available-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 7px 12px;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-muted, #6B7280);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    transition: color 0.12s ease;
  }

  .available-toggle:hover {
    color: var(--text, #111);
  }

  .available-toggle-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .count-pill {
    background: var(--bg-surface, #fff);
    border: 1px solid var(--border-subtle, #E5E7EB);
    color: var(--text-faint, #9CA3AF);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 999px;
    line-height: 1.4;
    letter-spacing: 0;
  }

  .chevron {
    color: var(--text-faint, #9CA3AF);
    transition: transform 0.18s ease;
  }

  .chevron--open {
    transform: rotate(180deg);
  }

  .available-list {
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid var(--border-subtle, #E5E7EB);
  }

  .available-list .participant-card {
    background: transparent;
    border: 1px solid transparent;
  }

  .available-list .participant-card:hover {
    background: var(--bg-surface, #fff);
    border-color: var(--border-subtle, #E5E7EB);
  }
</style>
