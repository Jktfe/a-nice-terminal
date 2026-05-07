<script lang="ts">
  // Voice-mode bar for interview chats.
  //
  // Mounts in the linked-chat header. When the user toggles voice on:
  //
  //   1. Each *new* agent message (role !== 'user', not in the snapshot we
  //      took at toggle time) is read aloud via the configured TTS provider.
  //   2. While TTS is playing, an Esc keypress OR a click on the floating
  //      Stop pill cancels playback and focuses the composer (so a Whisper
  //      Flow dictation lands somewhere useful).
  //   3. The text the agent was saying up to the interrupt point is captured
  //      via TTS boundary events (browser provider) or as the full
  //      remaining text (ElevenLabs) and exposed to the parent via the
  //      `onInterruptPhrase` callback. The parent's sendMessage attaches
  //      it as meta on the next user message so the agent has context.
  //
  // Provider choice persists in localStorage keyed by sessionId — voice mode
  // is a client-only UX preference, no server state required.

  import { onMount, onDestroy, untrack } from 'svelte';
  import { BrowserTTSProvider, ElevenLabsTTSProvider, type TTSProvider, type TTSHandle } from '$lib/voice/tts';

  interface Message {
    id: string;
    role?: string;
    sender_id?: string | null;
    content?: string;
    created_at?: string;
  }

  interface Props {
    sessionId: string;
    messages: Message[];
    /** Fired when an agent utterance is cut off; phrase is what the agent
        was saying up to the interrupt point. The parent should attach it
        as meta.interrupted_at on the next outgoing user message. */
    onInterruptPhrase?: (phrase: string) => void;
    /** Optional ref to the composer textarea so Esc can refocus it. */
    composerEl?: HTMLElement | null;
  }

  const { sessionId, messages, onInterruptPhrase, composerEl }: Props = $props();

  type ProviderName = 'browser' | 'elevenlabs';
  const STORAGE_KEY = $derived(`voice-mode:${sessionId}`);

  let enabled = $state(false);
  let providerName = $state<ProviderName>('browser');
  let elevenAvailable = $state(false);
  let provider: TTSProvider | null = null;
  let currentHandle: TTSHandle | null = null;
  let speakingMsgId = $state<string | null>(null);
  let speakingText = $state<string>('');
  let lastSpokenIndex = $state(-1);
  let lastBoundaryChar = $state(0);

  function loadPrefs() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      enabled = !!parsed.enabled;
      providerName = parsed.provider === 'elevenlabs' ? 'elevenlabs' : 'browser';
    } catch {}
  }

  function savePrefs() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, provider: providerName }));
    } catch {}
  }

  async function checkElevenLabs() {
    try {
      const res = await fetch('/api/voice/elevenlabs');
      if (!res.ok) return;
      const data = await res.json();
      elevenAvailable = !!data.available;
    } catch {
      elevenAvailable = false;
    }
  }

  function buildProvider(): TTSProvider {
    return providerName === 'elevenlabs' ? new ElevenLabsTTSProvider() : new BrowserTTSProvider();
  }

  function isAgentMessage(msg: Message): boolean {
    if (!msg) return false;
    if (msg.role === 'user') return false;
    return Boolean(msg.content && msg.content.trim().length > 0);
  }

  function stopSpeaking({ markInterrupt }: { markInterrupt: boolean }) {
    if (!currentHandle) return;
    const wasSpeakingText = speakingText;
    const cutAt = lastBoundaryChar;
    try {
      currentHandle.cancel();
    } catch {}
    currentHandle = null;
    speakingMsgId = null;
    speakingText = '';
    lastBoundaryChar = 0;

    if (markInterrupt && wasSpeakingText) {
      const phrase = cutAt > 0
        ? wasSpeakingText.slice(0, cutAt).trim()
        : wasSpeakingText.trim();
      if (phrase) onInterruptPhrase?.(phrase);
    }
  }

  function speak(msg: Message) {
    if (!provider) return;
    if (!msg.content) return;

    speakingMsgId = msg.id;
    speakingText = msg.content;
    lastBoundaryChar = 0;

    const handle = provider.speak(msg.content);
    currentHandle = handle;
    handle.onStart = () => {
      // already set speakingMsgId synchronously
    };
    handle.onEnd = () => {
      if (currentHandle === handle) {
        currentHandle = null;
        speakingMsgId = null;
        speakingText = '';
        lastBoundaryChar = 0;
      }
    };
    handle.onBoundary = (b) => {
      // Track the latest charIndex so an interrupt has a precise cut-point.
      lastBoundaryChar = b.charIndex + b.charLength;
    };
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (!currentHandle) return;
    // Only intercept Esc when something is actually speaking — otherwise let
    // other components (modals, menus) keep their Esc-to-close semantics.
    event.preventDefault();
    stopSpeaking({ markInterrupt: true });
    if (composerEl && typeof composerEl.focus === 'function') {
      composerEl.focus();
    }
  }

  function toggleEnabled() {
    enabled = !enabled;
    if (enabled) {
      // Don't speak the existing transcript; baseline at "current end of feed"
      // so only future agent messages get vocalised.
      lastSpokenIndex = messages.length - 1;
      provider = buildProvider();
    } else {
      stopSpeaking({ markInterrupt: false });
      provider = null;
    }
    savePrefs();
  }

  function setProvider(name: ProviderName) {
    if (providerName === name) return;
    providerName = name;
    if (enabled) {
      // Cancel any in-flight utterance under the old provider, swap.
      stopSpeaking({ markInterrupt: false });
      provider = buildProvider();
    }
    savePrefs();
  }

  onMount(() => {
    loadPrefs();
    void checkElevenLabs();
    if (enabled) {
      provider = buildProvider();
      // Baseline at current message count so we don't replay the history.
      lastSpokenIndex = messages.length - 1;
    }
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    stopSpeaking({ markInterrupt: false });
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
    }
  });

  // Watch the message stream — speak each new agent message that arrives
  // while voice mode is on. Guard with untrack so we don't loop on
  // speakingMsgId changes (which we set inside speak()).
  $effect(() => {
    if (!enabled || !provider) return;
    const len = messages.length;
    untrack(() => {
      if (len <= lastSpokenIndex + 1) return;
      // Speak the most recent message if it's an agent message we haven't
      // already spoken. We only speak the LAST agent message in a burst —
      // if multiple arrived between ticks we don't queue them all (would
      // overwhelm the listener); the latest is what matters.
      const latest = messages[len - 1];
      lastSpokenIndex = len - 1;
      if (latest && isAgentMessage(latest) && latest.id !== speakingMsgId) {
        // Cancel any in-flight utterance — new message wins.
        if (currentHandle) {
          try { currentHandle.cancel(); } catch {}
          currentHandle = null;
        }
        speak(latest);
      }
    });
  });

  // Keep enabled state in sync with localStorage if the storage key changes
  // (e.g., navigating between sessions reuses this component instance).
  $effect(() => {
    void STORAGE_KEY;
    untrack(() => {
      stopSpeaking({ markInterrupt: false });
      loadPrefs();
      if (enabled) {
        lastSpokenIndex = messages.length - 1;
        provider = buildProvider();
      } else {
        provider = null;
      }
    });
  });
</script>

<div class="voice-bar" class:is-on={enabled}>
  <button
    type="button"
    class="voice-toggle"
    class:is-on={enabled}
    onclick={toggleEnabled}
    aria-pressed={enabled}
    title={enabled ? 'Voice mode on — agent replies are read aloud. Click to turn off.' : 'Turn on voice mode to hear agent replies and interrupt with Esc.'}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
    </svg>
    <span class="voice-toggle-label">Voice {enabled ? 'on' : 'off'}</span>
  </button>

  {#if enabled}
    <div class="provider-pick" role="group" aria-label="Voice provider">
      <button
        type="button"
        class="provider-chip"
        class:is-selected={providerName === 'browser'}
        onclick={() => setProvider('browser')}
        title="Browser TTS — free, works offline, robotic voice"
      >Browser</button>
      <button
        type="button"
        class="provider-chip"
        class:is-selected={providerName === 'elevenlabs'}
        class:is-disabled={!elevenAvailable}
        disabled={!elevenAvailable}
        onclick={() => setProvider('elevenlabs')}
        title={elevenAvailable
          ? 'ElevenLabs — high quality, requires API key'
          : 'Set ELEVENLABS_API_KEY on the server to enable'}
      >ElevenLabs{!elevenAvailable ? ' (unset)' : ''}</button>
    </div>
  {/if}

  {#if speakingMsgId}
    <div class="speaking-indicator" aria-live="polite">
      <span class="speaking-dot"></span>
      <span class="speaking-label">Speaking… <kbd>Esc</kbd> to interrupt</span>
      <button
        type="button"
        class="speaking-stop"
        onclick={() => {
          stopSpeaking({ markInterrupt: true });
          if (composerEl?.focus) composerEl.focus();
        }}
        aria-label="Stop speaking"
        title="Stop speaking and capture interrupt"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .voice-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--bg-card, #F9FAFB);
    border: 1px solid var(--border-subtle, #E5E7EB);
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .voice-bar.is-on {
    border-color: color-mix(in srgb, #6366F1 35%, transparent);
    background: color-mix(in srgb, #6366F1 6%, var(--bg-surface, #fff));
  }

  .voice-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--border-subtle, #E5E7EB);
    background: var(--bg-surface, #fff);
    color: var(--text-muted, #6B7280);
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .voice-toggle:hover {
    border-color: var(--border-light, #D1D5DB);
    color: var(--text, #111);
  }

  .voice-toggle.is-on {
    background: #6366F1;
    border-color: #6366F1;
    color: #fff;
  }

  .voice-toggle.is-on:hover {
    background: #4F46E5;
    border-color: #4F46E5;
  }

  .provider-pick {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 6px;
    background: var(--bg-surface, #fff);
    border: 1px solid var(--border-subtle, #E5E7EB);
  }

  .provider-chip {
    padding: 3px 8px;
    border: 0;
    background: transparent;
    color: var(--text-muted, #6B7280);
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .provider-chip:hover:not(.is-selected):not(.is-disabled) {
    background: color-mix(in srgb, #6366F1 8%, transparent);
    color: var(--text, #111);
  }

  .provider-chip.is-selected {
    background: color-mix(in srgb, #6366F1 14%, transparent);
    color: #4F46E5;
  }

  .provider-chip.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .speaking-indicator {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, #6366F1 14%, var(--bg-surface, #fff));
    color: #4F46E5;
    font-size: 11px;
    font-weight: 500;
  }

  .speaking-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6366F1;
    animation: speaking-pulse 1.1s ease-in-out infinite;
  }

  @keyframes speaking-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.5; transform: scale(0.7); }
  }

  .speaking-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .speaking-label kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, #6366F1 30%, transparent);
    background: var(--bg-surface, #fff);
    color: #4F46E5;
  }

  .speaking-stop {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: #DC2626;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }

  .speaking-stop:hover {
    background: color-mix(in srgb, #DC2626 14%, transparent);
  }
</style>
