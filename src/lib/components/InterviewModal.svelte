<script lang="ts">
  // Interview modal — opened from MessageBubble's Interview chip.
  //
  // M1 scope (this file): entry/modal UI only. No server endpoints,
  // no audio/TTS, no transcript export, no summary post-back. Those
  // are m2/m3/m4/m5 in interview-lite-2026-05-08.
  //
  // The modal carries the parent message + room + a participant list
  // (target agent + optional same-room agents added by the user). It
  // exposes message append + per-agent mute hooks so m2 routing and
  // m3 voice can wire in without touching this component again.
  //
  // Boundary: this is NOT a chatroom — no tasks, files, remote-hands,
  // pinning, asks, or share affordances. Just a focused dialog.

  import NocturneIcon from './NocturneIcon.svelte';
  import { resolvePreferredProvider, type TTSProvider, type TTSHandle } from '$lib/voice/interview-tts';

  /** A message in the interview thread. Distinct from chat messages —
   *  no sender_id resolution, no replyMessage chain, no read receipts. */
  export interface InterviewMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    /** Sender identity for `agent` role only; the user is implicit. */
    agentHandle?: string;
    /** Set by m3 voice once a TTS audio blob has been generated and
     *  cached. Null = not yet read aloud or muted. */
    audioCacheKey?: string | null;
    createdAt: number;
  }

  /** Participant entry — the target agent plus any added same-room
   *  agents. Per-agent mute lives here, not on each message, so a
   *  toggle stops both future TTS playback and replays for that agent. */
  export interface InterviewParticipant {
    handle: string;
    displayName?: string;
    /** True when the user is the source-message agent — required slot,
     *  cannot be removed. Other added agents are removable. */
    isTarget: boolean;
    /** Default false (default-on speaking per JWPK 2026-05-08). When
     *  true, m3 voice skips TTS for this agent's messages. */
    muted: boolean;
  }

  let {
    open = false,
    parentMessage,
    parentRoomId,
    participants = [],
    candidateAgents = [],
    messages = [],
    busy = false,
    onClose,
    onSend,
    onAddParticipant,
    onRemoveParticipant,
    onToggleMute,
    onEndInterview,
  }: {
    open: boolean;
    /** The chat message the interview was launched from. Sets the
     *  default target agent and is the reply_to anchor for the summary
     *  posted back when the interview ends. */
    parentMessage: { id: string; content: string; sender_id?: string | null };
    parentRoomId: string;
    participants: InterviewParticipant[];
    /** Same-room agents not currently in the interview, surfaced by
     *  the "+ add" picker. Caller computes from the room's session list. */
    candidateAgents: { handle: string; displayName?: string }[];
    messages: InterviewMessage[];
    busy?: boolean;
    onClose?: () => void;
    onSend?: (content: string) => void | Promise<void>;
    onAddParticipant?: (handle: string) => void | Promise<void>;
    onRemoveParticipant?: (handle: string) => void | Promise<void>;
    onToggleMute?: (handle: string, muted: boolean) => void | Promise<void>;
    onEndInterview?: () => void | Promise<void>;
  } = $props();

  let composer = $state('');
  let scrollEl: HTMLDivElement | null = $state(null);
  let pickerOpen = $state(false);
  /** Used by the focus trap to bound Tab cycling. */
  let cardEl: HTMLElement | null = $state(null);

  // Focus the composer on open so the user can start typing immediately.
  let composerEl: HTMLTextAreaElement | null = $state(null);
  $effect(() => {
    if (open && composerEl) composerEl.focus();
  });

  /** Restore focus to the element that opened the modal (the Interview
   *  chip on a chat message) when the modal closes. Captured on open
   *  via the focusin event so we don't leak state across opens. */
  let returnFocusTo: HTMLElement | null = null;
  $effect(() => {
    if (open && typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !active.closest('.iv-card')) {
        returnFocusTo = active;
      }
      return () => {
        // On modal close, return focus to the original trigger so
        // keyboard users land back where they started.
        try { returnFocusTo?.focus(); } catch {}
        returnFocusTo = null;
      };
    }
  });

  // ── TTS playback (m3 voice) ─────────────────────────────────────────
  // Per-message audio cache keyed by message id. Stores the object URL
  // returned by the ElevenLabs provider so the user can replay any agent
  // message after the interview ends. Browser TTS doesn't produce a
  // cacheable blob, so its entries map to null and the replay button
  // re-synthesises on click.
  let ttsProvider: TTSProvider | null = $state(null);
  const audioCache = new Map<string, string | null>();
  let activeHandle: TTSHandle | null = null;
  let activeMsgId = $state<string | null>(null);
  let activePaused = $state(false);
  // Track which message ids we've already auto-spoken so re-renders
  // don't replay the entire history on every effect tick (the
  // prime-on-mount pattern from feedback_svelte5_effect_prime_on_mount).
  const spokenIds = new Set<string>();
  let primed = false;

  $effect(() => {
    if (!open) {
      // Reset per-interview TTS state when the modal closes.
      activeHandle?.cancel();
      activeHandle = null;
      activeMsgId = null;
      spokenIds.clear();
      primed = false;
      return;
    }
    if (!ttsProvider) {
      void resolvePreferredProvider().then((p) => { ttsProvider = p; });
    }
  });

  // Auto-speak new agent messages (default-on; per-agent mute silences).
  // First run on open primes the spoken set without playback so we don't
  // re-speak the entire history.
  $effect(() => {
    if (!open) return;
    if (!ttsProvider) return;
    const provider = ttsProvider;
    const muted = new Set(participants.filter((p) => p.muted).map((p) => p.handle));
    if (!primed) {
      for (const m of messages) spokenIds.add(m.id);
      primed = true;
      return;
    }
    for (const m of messages) {
      if (spokenIds.has(m.id)) continue;
      spokenIds.add(m.id);
      if (m.role !== 'agent') continue;
      if (m.agentHandle && muted.has(m.agentHandle)) continue;
      // Cancel any prior playback so multi-message bursts don't pile up.
      activeHandle?.cancel();
      activeMsgId = m.id;
      const handle = provider.speak(m.content);
      activeHandle = handle;
      handle.onEnd = () => {
        if (activeMsgId === m.id) {
          activeHandle = null;
          activeMsgId = null;
          activePaused = false;
        }
      };
      void handle.audioUrl().then((url) => {
        if (url) audioCache.set(m.id, url);
        else audioCache.set(m.id, null);
      });
    }
  });

  function pauseNarration() {
    if (!activeHandle) return;
    activeHandle.pause();
    activePaused = true;
  }
  function resumeNarration() {
    if (!activeHandle) return;
    activeHandle.resume();
    activePaused = false;
  }
  function stopNarration() {
    if (!activeHandle) return;
    activeHandle.cancel();
    activeHandle = null;
    activeMsgId = null;
    activePaused = false;
  }

  function replayMessage(m: InterviewMessage) {
    if (!ttsProvider) return;
    const cachedUrl = audioCache.get(m.id);
    activeHandle?.cancel();
    if (cachedUrl) {
      // Cached blob URL — replay without re-synthesising.
      const audio = new Audio(cachedUrl);
      audio.play().catch(() => {});
      return;
    }
    // Fallback: re-synthesise (browser TTS path).
    activeMsgId = m.id;
    activeHandle = ttsProvider.speak(m.content);
    activeHandle.onEnd = () => {
      if (activeMsgId === m.id) {
        activeHandle = null;
        activeMsgId = null;
      }
    };
  }

  // Auto-scroll to the latest message whenever the message list grows.
  $effect(() => {
    if (!scrollEl) return;
    if (messages.length === 0) return;
    // Settle after the DOM updates the new row.
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && event.target === composerEl) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Tab' && cardEl) {
      // Focus trap: cycle Tab/Shift-Tab inside the modal so keyboard
      // users don't leak focus back to the underlying chat (which has
      // hover-only action chips that disappear when not focused).
      const focusable = cardEl.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !cardEl.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !cardEl.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  async function submit() {
    const text = composer.trim();
    if (!text) return;
    composer = '';
    await onSend?.(text);
  }

  function targetParticipant(): InterviewParticipant | null {
    return participants.find((p) => p.isTarget) ?? participants[0] ?? null;
  }

  const targetLabel = $derived(() => {
    const t = targetParticipant();
    if (!t) return 'agent';
    return t.displayName ?? t.handle;
  });
</script>

{#if open}
  <div
    class="iv-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={`Interview with ${targetLabel()}`}
    tabindex="-1"
    onkeydown={handleKey}
  >
    <button
      type="button"
      class="iv-scrim"
      aria-label="Close interview"
      onclick={() => onClose?.()}
    ></button>

    <section class="iv-card" bind:this={cardEl}>
      <header class="iv-head">
        <div class="iv-head-title">
          <span class="iv-head-eyebrow">Interview</span>
          <h2>{targetLabel()}</h2>
          <span class="iv-head-source" title={parentMessage.content}>
            from "{(parentMessage.content ?? '').slice(0, 80)}{(parentMessage.content ?? '').length > 80 ? '…' : ''}"
          </span>
        </div>
        {#if activeMsgId}
          <!-- Narration controls — surface when an utterance is in
               flight so the user can pause / resume / stop the read-aloud
               without scrolling to the per-message replay button. -->
          {#if activePaused}
            <button
              type="button"
              class="iv-narration"
              onclick={resumeNarration}
              title="Resume narration"
              aria-label="Resume narration"
            >
              <NocturneIcon name="play" size={11} color="currentColor" />
              <span>resume</span>
            </button>
          {:else}
            <button
              type="button"
              class="iv-narration"
              onclick={pauseNarration}
              title="Pause narration"
              aria-label="Pause narration"
            >
              <span class="iv-pause-glyph" aria-hidden="true">⏸</span>
              <span>pause</span>
            </button>
          {/if}
          <button
            type="button"
            class="iv-narration"
            onclick={stopNarration}
            title="Stop narration"
            aria-label="Stop narration"
          >
            <span class="iv-stop-glyph" aria-hidden="true">⏹</span>
            <span>stop</span>
          </button>
        {/if}
        <button
          type="button"
          class="iv-end"
          onclick={() => onEndInterview?.()}
          disabled={busy}
          title="End interview, save transcript, post summary"
        >End interview</button>
        <button
          type="button"
          class="iv-close"
          onclick={() => onClose?.()}
          aria-label="Close (interview stays open in the background)"
        >
          <NocturneIcon name="x" size={14} color="var(--text-muted)" />
        </button>
      </header>

      <div class="iv-participants" aria-label="Interview participants">
        {#each participants as p (p.handle)}
          <div class="iv-participant" class:iv-participant--muted={p.muted}>
            <span class="iv-pdot" data-target={p.isTarget ? 'true' : 'false'}></span>
            <span class="iv-phandle">{p.displayName ?? p.handle}</span>
            {#if p.isTarget}
              <span class="iv-ptag">target</span>
            {/if}
            <button
              type="button"
              class="iv-pmute"
              onclick={() => onToggleMute?.(p.handle, !p.muted)}
              title={p.muted ? `Unmute ${p.handle}` : `Mute ${p.handle}`}
              aria-pressed={p.muted}
            >
              <NocturneIcon name={p.muted ? 'x' : 'mic'} size={11} color="currentColor" />
              <span>{p.muted ? 'muted' : 'speaking'}</span>
            </button>
            {#if !p.isTarget}
              <button
                type="button"
                class="iv-premove"
                onclick={() => onRemoveParticipant?.(p.handle)}
                title={`Remove ${p.handle} from this interview`}
                aria-label={`Remove ${p.handle}`}
              >
                <NocturneIcon name="x" size={10} color="currentColor" />
              </button>
            {/if}
          </div>
        {/each}
        {#if candidateAgents.length > 0}
          <div class="iv-add-wrap">
            <button
              type="button"
              class="iv-add-btn"
              onclick={() => (pickerOpen = !pickerOpen)}
              aria-expanded={pickerOpen}
              title="Add an agent from this room"
            >+ add agent</button>
            {#if pickerOpen}
              <div class="iv-picker" role="menu">
                {#each candidateAgents as a (a.handle)}
                  <button
                    type="button"
                    class="iv-picker-row"
                    role="menuitem"
                    onclick={() => {
                      pickerOpen = false;
                      void onAddParticipant?.(a.handle);
                    }}
                  >
                    <span class="iv-pdot"></span>
                    <span>{a.displayName ?? a.handle}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="iv-thread"
        bind:this={scrollEl}
        role="log"
        aria-live="polite"
        aria-label="Interview transcript"
      >
        {#if messages.length === 0}
          <p class="iv-empty">
            Send a message to start the interview. The
            target agent (and any added agents) will reply here, and
            their responses will be read aloud unless you mute them.
          </p>
        {/if}
        {#each messages as m (m.id)}
          <div class="iv-msg" data-role={m.role}>
            <span class="iv-msg-meta">
              <span>{m.role === 'user' ? 'You' : (m.agentHandle ?? 'agent')}</span>
              {#if m.role === 'agent'}
                <button
                  type="button"
                  class="iv-replay"
                  onclick={() => replayMessage(m)}
                  title={activeMsgId === m.id ? 'Currently playing' : 'Replay this message'}
                  aria-label="Replay message audio"
                >
                  <NocturneIcon name={activeMsgId === m.id ? 'mic' : 'play'} size={10} color="currentColor" />
                </button>
              {/if}
            </span>
            <p class="iv-msg-body">{m.content}</p>
          </div>
        {/each}
      </div>

      <form
        class="iv-composer"
        onsubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <textarea
          bind:this={composerEl}
          bind:value={composer}
          placeholder="Type a question or use Whisper Flow / system dictation. Enter to send, Shift+Enter for newline."
          rows="2"
          aria-label="Interview message"
          disabled={busy}
        ></textarea>
        <button
          type="submit"
          class="iv-send"
          disabled={busy || composer.trim().length === 0}
          aria-label="Send"
        >
          <NocturneIcon name="send" size={13} color="currentColor" />
          <span>send</span>
        </button>
      </form>
    </section>
  </div>
{/if}

<style>
  .iv-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .iv-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    border: 0;
    cursor: pointer;
    backdrop-filter: blur(2px);
  }
  .iv-card {
    position: relative;
    z-index: 1;
    width: min(680px, 100%);
    max-height: min(720px, 90vh);
    display: flex;
    flex-direction: column;
    background: var(--surface, #fff);
    color: var(--text, #111);
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.16));
    border-radius: 10px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    font: 14px/1.5 var(--font-sans, -apple-system, system-ui, sans-serif);
  }

  .iv-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
  }
  .iv-head-title { flex: 1; min-width: 0; }
  .iv-head-eyebrow {
    display: block;
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #6b7280);
  }
  .iv-head-title h2 {
    margin: 2px 0 0;
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .iv-head-source {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--text-muted, #6b7280);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .iv-end {
    border: 0.5px solid currentColor;
    background: transparent;
    color: var(--accent-amber, #c2860a);
    font: inherit;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .iv-narration {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0.5px solid currentColor;
    background: transparent;
    color: var(--text-muted, #6b7280);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .iv-narration:hover {
    color: var(--text, #111);
  }
  .iv-pause-glyph,
  .iv-stop-glyph {
    font-size: 11px;
    line-height: 1;
  }
  .iv-end:hover:not(:disabled) {
    background: rgba(194, 134, 10, 0.08);
  }
  .iv-end:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .iv-close {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .iv-close:hover { background: var(--hairline, rgba(0, 0, 0, 0.06)); }

  .iv-participants {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
  }
  .iv-participant {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.14));
    background: var(--hairline, rgba(0, 0, 0, 0.04));
    font-size: 12px;
  }
  .iv-participant--muted {
    opacity: 0.55;
  }
  .iv-pdot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--accent-blue, #3b82f6);
  }
  .iv-pdot[data-target='true'] {
    background: var(--accent-emerald, #22c55e);
  }
  .iv-phandle { font-family: var(--font-mono, monospace); font-size: 11.5px; }
  .iv-ptag {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, #6b7280);
  }
  .iv-pmute {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0.5px solid currentColor;
    background: transparent;
    color: inherit;
    padding: 0 6px;
    border-radius: 3px;
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
    line-height: 18px;
  }
  .iv-pmute:hover { background: rgba(0, 0, 0, 0.04); }
  .iv-premove {
    border: 0;
    background: transparent;
    color: var(--text-muted, #6b7280);
    cursor: pointer;
    padding: 0 2px;
    display: inline-flex;
    align-items: center;
  }
  .iv-premove:hover { color: var(--text, #111); }
  .iv-add-wrap {
    position: relative;
    display: inline-flex;
  }
  .iv-add-btn {
    border: 0.5px dashed var(--hairline-strong, rgba(0, 0, 0, 0.18));
    background: transparent;
    color: var(--text-muted, #6b7280);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 10px;
    border-radius: 999px;
    cursor: pointer;
  }
  .iv-add-btn:hover { color: var(--text, #111); }
  .iv-picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--surface, #fff);
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.16));
    border-radius: 6px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
    min-width: 180px;
    z-index: 2;
    padding: 4px;
  }
  .iv-picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 12px;
    text-align: left;
  }
  .iv-picker-row:hover { background: var(--hairline, rgba(0, 0, 0, 0.05)); }

  .iv-thread {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-soft, rgba(0, 0, 0, 0.015));
  }
  .iv-empty {
    color: var(--text-muted, #6b7280);
    font-size: 12.5px;
    margin: 8px 0;
    line-height: 1.55;
  }
  .iv-msg {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 92%;
  }
  .iv-msg[data-role='user'] {
    align-self: flex-end;
    align-items: flex-end;
  }
  .iv-msg-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-mono, monospace);
  }
  .iv-replay {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0;
    color: var(--text-muted, #6b7280);
    display: inline-flex;
    align-items: center;
  }
  .iv-replay:hover { color: var(--text, #111); }
  .iv-msg-body {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--surface, #fff);
    border: 0.5px solid var(--hairline, rgba(0, 0, 0, 0.08));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .iv-msg[data-role='user'] .iv-msg-body {
    background: var(--accent-blue, #3b82f6);
    color: #fff;
    border-color: transparent;
  }

  .iv-composer {
    display: flex;
    gap: 8px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
    background: var(--surface, #fff);
  }
  .iv-composer textarea {
    flex: 1;
    resize: vertical;
    min-height: 44px;
    max-height: 180px;
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.16));
    background: var(--bg-soft, rgba(0, 0, 0, 0.02));
    color: inherit;
    border-radius: 6px;
    padding: 8px 10px;
    font: inherit;
    font-size: 13px;
  }
  .iv-composer textarea:focus {
    outline: 2px solid var(--accent-blue, #3b82f6);
    outline-offset: -1px;
  }
  .iv-send {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: var(--accent-blue, #3b82f6);
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    padding: 9px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  .iv-send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
