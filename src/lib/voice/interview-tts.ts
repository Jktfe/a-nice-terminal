// Text-to-speech provider abstraction for the Interview-Lite modal.
//
// Two implementations share the same TTSProvider interface so the
// consumer (InterviewModal page state) doesn't care which one is in
// use:
//
//   BrowserTTSProvider   — window.speechSynthesis. Free, robotic, but
//                           works offline.
//   ElevenLabsTTSProvider — POSTs to /api/voice/elevenlabs (server
//                           proxy holds the API key) and plays the
//                           returned MPEG audio via an HTMLAudioElement.
//                           Higher quality, costs money, opt-in via
//                           ELEVENLABS_API_KEY env on the server (per
//                           interview-lite-2026-05-08 m3 a3-settings —
//                           global config, not per-user).
//
// Both return a TTSHandle whose .cancel() halts playback immediately
// AND whose .audioUrl resolves once the elevenlabs blob is ready, so
// the consumer can cache it for replay (m3 a3-cache).
//
// File path is intentionally `interview-tts.ts` not `tts.ts` — the
// older voice mode at `src/lib/voice/tts.ts` was ripped in commit
// e49f2c6 ("rip out interview + voice mode entirely") and we don't
// want to silently revive it under the original path.

export interface TTSHandle {
  cancel(): void;
  /** Pause an in-flight utterance — no-ops if the underlying
   *  provider has already finished or doesn't support it. resume()
   *  picks back up at the same point for both providers. */
  pause(): void;
  resume(): void;
  /** True while the underlying audio/utterance is paused. */
  isPaused(): boolean;
  /** Resolves with an object URL for the generated audio when the
   *  provider produces a cacheable blob (ElevenLabs). The browser
   *  provider can't cache its on-the-fly synthesis, so this resolves
   *  to null. */
  audioUrl(): Promise<string | null>;
  onStart?: () => void;
  onEnd?: () => void;
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

// ── Browser native ─────────────────────────────────────────────────
export class BrowserTTSProvider implements TTSProvider {
  readonly name = 'browser' as const;

  available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text: string, opts: TTSSpeakOpts = {}): TTSHandle {
    if (!this.available()) {
      return {
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        isPaused: () => false,
        audioUrl: () => Promise.resolve(null),
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

    let paused = false;
    const handle: TTSHandle = {
      cancel: () => window.speechSynthesis.cancel(),
      pause: () => { window.speechSynthesis.pause(); paused = true; },
      resume: () => { window.speechSynthesis.resume(); paused = false; },
      isPaused: () => paused,
      audioUrl: () => Promise.resolve(null),
    };

    utter.onstart = () => handle.onStart?.();
    utter.onend = () => { paused = false; handle.onEnd?.(); };
    utter.onerror = () => { paused = false; handle.onEnd?.(); };

    window.speechSynthesis.speak(utter);
    return handle;
  }
}

// ── ElevenLabs via server proxy ────────────────────────────────────
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

    let resolveUrl!: (value: string | null) => void;
    const urlPromise = new Promise<string | null>((resolve) => {
      resolveUrl = resolve;
    });

    let paused = false;
    const handle: TTSHandle = {
      cancel: () => {
        cancelled = true;
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        // Don't revoke blobUrl on cancel — caller may still want to
        // cache the partial audio for replay. The handle owner is
        // responsible for releasing the URL when it falls off the LRU.
      },
      pause: () => {
        if (audio && !audio.paused) {
          audio.pause();
          paused = true;
        }
      },
      resume: () => {
        if (audio && audio.paused) {
          void audio.play();
          paused = false;
        }
      },
      isPaused: () => paused,
      audioUrl: () => urlPromise,
    };

    (async () => {
      try {
        const res = await fetch('/api/voice/elevenlabs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_id: opts.voiceId }),
        });
        if (cancelled) {
          resolveUrl(null);
          return;
        }
        if (!res.ok) {
          resolveUrl(null);
          handle.onEnd?.();
          return;
        }
        const blob = await res.blob();
        if (cancelled) {
          resolveUrl(null);
          return;
        }
        blobUrl = URL.createObjectURL(blob);
        resolveUrl(blobUrl);
        audio = new Audio(blobUrl);
        audio.onplay = () => handle.onStart?.();
        audio.onended = () => { paused = false; handle.onEnd?.(); };
        audio.onerror = () => { paused = false; handle.onEnd?.(); };
        await audio.play();
      } catch {
        resolveUrl(null);
        handle.onEnd?.();
      }
    })();

    return handle;
  }
}

/** Build the right provider for the global config. The page reads
 *  /api/voice/elevenlabs (GET) to decide if the ElevenLabs path is
 *  available; if not, it falls through to the browser provider. */
export function makeTTSProvider(name: 'browser' | 'elevenlabs'): TTSProvider {
  if (name === 'elevenlabs') return new ElevenLabsTTSProvider();
  return new BrowserTTSProvider();
}

/** Resolve the best available provider given current global config.
 *  Calls /api/voice/elevenlabs to detect server-side ELEVENLABS_API_KEY,
 *  falls back to browser. Cached to a single call per page load via the
 *  ElevenLabsTTSProvider's own cachedAvailability flag. */
export async function resolvePreferredProvider(): Promise<TTSProvider> {
  if (typeof window === 'undefined') return new BrowserTTSProvider();
  const elevenlabs = new ElevenLabsTTSProvider();
  if (await elevenlabs.available()) return elevenlabs;
  return new BrowserTTSProvider();
}
