/**
 * Bring-in-App client adapters — web v0.
 *
 * Spec at docs/research/bring-in-app-spec-2026-05-25.md (ratified by
 * JWPK msg_a0s51ioct6 2026-05-25 — "Q2: Yes"). Server contract shipped
 * at c80f351; this module is the CLIENT side that consumes the payload
 * + dispatches to the operator's machine via the platform-appropriate
 * launch protocol.
 *
 * v0 ships Claude Desktop only (Anthropic-first per the spec). Other
 * targets render disabled with "Coming in v0.5" tooltip until their
 * adapter lands.
 *
 * Launch strategy ladder per spec:
 *   1. URL scheme  (e.g. `claude://`) — works when the target app is
 *      installed + the scheme is registered with the OS
 *   2. Clipboard   — fallback when URL scheme unavailable; copies the
 *      payload markdown for paste-into-app
 *   3. Share Sheet — Web Share API on supported platforms
 *
 * v0 keeps it simple: try URL scheme via window.location, fall back to
 * clipboard write + nudge toast if URL scheme silently fails.
 */

import type { BringInTarget, RoomContextPayload } from './types';

export type LaunchMethod = 'url-scheme' | 'clipboard' | 'share-sheet';

export type LaunchOutcome = {
  method: LaunchMethod;
  status: 'launched' | 'fallback' | 'unavailable';
  message: string;
};

export type ClientAdapter = {
  target: BringInTarget;
  label: string;
  /** v0 = available in this slice; v0.5+ = label-only placeholder. */
  available: boolean;
  /** Short user-visible reason when `available` is false. */
  unavailableReason?: string;
  /** Drive the launch. Returns the outcome for telemetry + UI feedback. */
  launch(payload: RoomContextPayload): Promise<LaunchOutcome>;
};

/**
 * Build the Claude Desktop opening prompt from a room context payload.
 * Claude Desktop will treat this as the operator's first user-message
 * once the URL scheme drops them into a fresh thread.
 */
function buildClaudeDesktopPrompt(payload: RoomContextPayload): string {
  const sections: string[] = [];
  sections.push(`I'm working in an ANT room called "${payload.roomName}".`);
  if (payload.roomDescription) {
    sections.push(`Room context: ${payload.roomDescription}`);
  }
  if (payload.openAsksMarkdown) {
    sections.push(`Open asks in this room:\n${payload.openAsksMarkdown}`);
  }
  if (payload.recentMessagesMarkdown) {
    sections.push(`Recent conversation:\n${payload.recentMessagesMarkdown}`);
  }
  sections.push(`Please help me think about this.`);
  return sections.join('\n\n');
}

const claudeDesktopAdapter: ClientAdapter = {
  target: 'claude-desktop',
  label: 'Bring in Claude Desktop',
  available: true,
  async launch(payload) {
    const prompt = buildClaudeDesktopPrompt(payload);
    // Try the URL scheme first. Claude Desktop registers `claude://` —
    // a fresh thread can be opened with `claude://new?text=<encoded>`.
    // If the OS can't handle the scheme it silently no-ops; we fall
    // back to clipboard so the operator can paste manually.
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      // Browsers don't expose "can this URL scheme handle?" reliably, so
      // we kick the navigation AND prepare the clipboard as a safety net.
      try {
        const encoded = encodeURIComponent(prompt);
        // Use a hidden iframe to attempt the URL scheme without leaving
        // the room page — leaves the tab intact if the scheme fails.
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `claude://new?text=${encoded}`;
        document.body.appendChild(iframe);
        // Always copy to clipboard as a parallel fallback. The operator
        // gets two paths: the URL scheme tries to open the app; the
        // clipboard is ready for paste-in if the scheme didn't take.
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(prompt);
        }
        // Schedule cleanup so the iframe doesn't linger.
        setTimeout(() => iframe.remove(), 1000);
        return {
          method: 'url-scheme',
          status: 'launched',
          message: 'Opening Claude Desktop. Prompt also copied to clipboard.'
        };
      } catch (cause) {
        // URL scheme path failed — clipboard fallback.
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(prompt);
            return {
              method: 'clipboard',
              status: 'fallback',
              message: 'Prompt copied to clipboard. Open Claude Desktop and paste to start.'
            };
          }
        } catch { /* clipboard also unavailable */ }
        return {
          method: 'url-scheme',
          status: 'unavailable',
          message: `Couldn't open Claude Desktop: ${cause instanceof Error ? cause.message : 'unknown'}`
        };
      }
    }
    return {
      method: 'url-scheme',
      status: 'unavailable',
      message: 'Browser environment unavailable.'
    };
  }
};

const claudeMobileAdapter: ClientAdapter = {
  target: 'claude-mobile',
  label: 'Bring in Claude Mobile',
  available: false,
  unavailableReason: 'iOS adapter ships in v0.5',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Claude Mobile adapter not in v0.' };
  }
};

const chatgptAdapter: ClientAdapter = {
  target: 'chatgpt',
  label: 'Bring in ChatGPT',
  available: false,
  unavailableReason: 'ChatGPT adapter ships in v0.5',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'ChatGPT adapter not in v0.' };
  }
};

const codexDesktopAdapter: ClientAdapter = {
  target: 'codex-desktop',
  label: 'Bring in Codex Desktop',
  available: false,
  unavailableReason: 'Codex Desktop adapter ships in v0.5',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Codex Desktop adapter not in v0.' };
  }
};

const geminiAdapter: ClientAdapter = {
  target: 'gemini',
  label: 'Bring in Gemini',
  available: false,
  unavailableReason: 'Gemini adapter ships in v0.5',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Gemini adapter not in v0.' };
  }
};

export const BRING_IN_APP_ADAPTERS: ClientAdapter[] = [
  claudeDesktopAdapter,
  claudeMobileAdapter,
  chatgptAdapter,
  codexDesktopAdapter,
  geminiAdapter
];

export function findAdapter(target: BringInTarget): ClientAdapter | undefined {
  return BRING_IN_APP_ADAPTERS.find((a) => a.target === target);
}

// Re-export for tests; not the public API surface for callers.
export { buildClaudeDesktopPrompt as _buildClaudeDesktopPromptForTests };
