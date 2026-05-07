// Text-to-speech provider abstraction for voice-mode interviews.
//
// Two implementations share the same TTSProvider interface so the consumer
// (VoiceModeBar) doesn't care which one is in use:
//
//   BrowserTTSProvider   — window.speechSynthesis. Free, robotic, but works
//                           offline and emits per-word `boundary` events so we
//                           can capture the exact phrase the user interrupted on.
//
//   ElevenLabsTTSProvider — POSTs to /api/voice/elevenlabs (server proxy holds
//                           the API key) and plays the returned MPEG audio via
//                           an HTMLAudioElement. Higher quality, costs money,
//                           opt-in via ELEVENLABS_API_KEY env on the server.
//
// Both return a TTSHandle whose .cancel() halts playback immediately. The
// `onBoundary` callback fires for browser TTS only — ElevenLabs streams audio
// without phoneme-level granularity, so consumers fall back to "agent was
// saying <full text>" when they need an interrupt marker on that path.

export interface TTSBoundary {
  charIndex: number;
  charLength: number;
  word: string;
}

export interface TTSHandle {
  cancel(): void;
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: (boundary: TTSBoundary) => void;
}

export interface TTSProvider {
  readonly name: 'browser' | 'elevenlabs';
  available(): boolean | Promise<boolean>;
  speak(text: string, opts?: TTSSpeakOpts): TTSHandle;
}

export interface TTSSpeakOpts {
  voiceId?: string;
  rate?: number;
  pitch?: number;
}

// ── Browser native ─────────────────────────────────────────────────────────
export class BrowserTTSProvider implements TTSProvider {
  readonly name = 'browser' as const;

  available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text: string, opts: TTSSpeakOpts = {}): TTSHandle {
    if (!this.available()) {
      // Synthesise a no-op handle so the caller doesn't have to null-guard.
      return {
        cancel: () => {},
      };
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = opts.rate ?? 1.0;
    utter.pitch = opts.pitch ?? 1.0;

    if (opts.voiceId) {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.name === opts.voiceId || v.voiceURI === opts.voiceId);
      if (match) utter.voice = match;
    }

    const handle: TTSHandle = {
      cancel: () => window.speechSynthesis.cancel(),
    };

    utter.onstart = () => handle.onStart?.();
    utter.onend = () => handle.onEnd?.();
    utter.onerror = () => handle.onEnd?.();
    utter.onboundary = (event) => {
      // Word-level boundaries arrive as { name: 'word', charIndex, charLength }
      // Sentence boundaries also arrive — we forward both; the consumer can
      // decide which to track for interrupt-phrase capture.
      handle.onBoundary?.({
        charIndex: event.charIndex,
        charLength: event.charLength ?? 0,
        word: text.slice(event.charIndex, event.charIndex + (event.charLength ?? 0)),
      });
    };

    window.speechSynthesis.speak(utter);
    return handle;
  }
}

// ── ElevenLabs via server proxy ───────────────────────────────────────────
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs' as const;
  private cachedAvailability: boolean | null = null;

  async available(): Promise<boolean> {
    if (this.cachedAvailability !== null) return this.cachedAvailability;
    try {
      const res = await fetch('/api/voice/elevenlabs');
      if (!res.ok) {
        this.cachedAvailability = false;
        return false;
      }
      const data = await res.json();
      this.cachedAvailability = !!data.available;
      return this.cachedAvailability;
    } catch {
      this.cachedAvailability = false;
      return false;
    }
  }

  speak(text: string, opts: TTSSpeakOpts = {}): TTSHandle {
    let audio: HTMLAudioElement | null = null;
    let blobUrl: string | null = null;
    let cancelled = false;

    const handle: TTSHandle = {
      cancel: () => {
        cancelled = true;
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          blobUrl = null;
        }
      },
    };

    (async () => {
      try {
        const res = await fetch('/api/voice/elevenlabs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_id: opts.voiceId }),
        });
        if (cancelled) return;
        if (!res.ok) {
          handle.onEnd?.();
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        audio = new Audio(blobUrl);
        audio.onplay = () => handle.onStart?.();
        audio.onended = () => {
          handle.onEnd?.();
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = null;
          }
        };
        audio.onerror = () => handle.onEnd?.();
        await audio.play();
      } catch {
        handle.onEnd?.();
      }
    })();

    return handle;
  }
}

// Pick the provider for a chat. Caller decides; this is just a small factory
// that knows how to build each one. ElevenLabs availability is async so the
// caller should `await provider.available()` before relying on it.
export function makeTTSProvider(name: 'browser' | 'elevenlabs'): TTSProvider {
  if (name === 'elevenlabs') return new ElevenLabsTTSProvider();
  return new BrowserTTSProvider();
}
