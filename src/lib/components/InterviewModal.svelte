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
  //
  // 2026-05-21: split into InterviewModalHeader / *Participants / *Thread /
  // *Composer sub-components to keep this file under the 600-line cap.
  // All state + side effects stay here so behaviour is unchanged.

  import InterviewModalHeader from './InterviewModalHeader.svelte';
  import InterviewModalParticipants from './InterviewModalParticipants.svelte';
  import InterviewModalThread from './InterviewModalThread.svelte';
  import InterviewModalComposer from './InterviewModalComposer.svelte';
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
    lastErrorMessage = '',
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
    /** Surface any error returned by the parent's end / send / add-participant
     *  handlers so the operator sees WHY a click did nothing. Empty string
     *  hides the banner. Banked from JWPK msg_pooxj42nl0: end-button-bug
     *  symptom was a silent PATCH failure — the modal must show it. */
    lastErrorMessage?: string;
    onClose?: () => void;
    onSend?: (content: string) => void | Promise<void>;
    onAddParticipant?: (handle: string) => void | Promise<void>;
    onRemoveParticipant?: (handle: string) => void | Promise<void>;
    onToggleMute?: (handle: string, muted: boolean) => void | Promise<void>;
    onEndInterview?: () => void | Promise<void>;
  } = $props();

  let composer = $state('');
  let scrollEl: HTMLDivElement | null = $state(null);
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
      <InterviewModalHeader
        targetLabel={targetLabel()}
        parentMessageContent={parentMessage.content}
        {activeMsgId}
        {activePaused}
        {busy}
        onPause={pauseNarration}
        onResume={resumeNarration}
        onStop={stopNarration}
        onEndInterview={() => onEndInterview?.()}
        onClose={() => onClose?.()}
      />

      {#if lastErrorMessage}
        <!-- Visible error surface (JWPK msg_pooxj42nl0 (f)): the previous
             modal swallowed PATCH-end / send-message failures into the
             parent's lastErrorMessage which never reached this UI. Now the
             parent threads the error in via the prop and we render it
             inline so the operator sees why a click did nothing. -->
        <div class="iv-error" role="alert">
          <span class="iv-error-glyph" aria-hidden="true">!</span>
          <p>{lastErrorMessage}</p>
        </div>
      {/if}

      <InterviewModalParticipants
        {participants}
        {candidateAgents}
        {onAddParticipant}
        {onRemoveParticipant}
        {onToggleMute}
      />

      <InterviewModalThread
        {messages}
        {activeMsgId}
        bind:scrollEl
        onReplay={replayMessage}
      />

      <InterviewModalComposer
        bind:composer
        bind:composerEl
        {busy}
        onSubmit={submit}
      />
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

  .iv-error {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 10px 16px;
    margin: 0;
    background: color-mix(in srgb, var(--accent, #c63b3b) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent, #c63b3b) 28%, transparent);
    color: var(--text, #1b1810);
  }
  .iv-error-glyph {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent, #c63b3b);
    color: white;
    font-size: 11px;
    font-weight: 900;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }
  .iv-error p {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text, #1b1810);
  }
</style>
