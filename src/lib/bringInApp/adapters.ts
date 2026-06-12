/**
 * Bring-in-App client adapters — web v0.5.
 *
 * Spec at docs/research/bring-in-app-spec-2026-05-25.md (ratified by
 * JWPK msg_a0s51ioct6 2026-05-25 — "Q2: Yes"). Server contract shipped
 * at c80f351; this module is the CLIENT side that consumes the payload
 * + dispatches to the operator's machine via the platform-appropriate
 * launch protocol.
 *
 * v0 shipped Claude Desktop only. v0.5 adds ChatGPT (clipboard-only).
 * Other targets render disabled with "Coming in v1" tooltip until their
 * adapter lands.
 *
 * Launch strategy ladder per spec:
 *   1. URL scheme  (e.g. `claude://`) — works when the target app is
 *      installed + the scheme is registered with the OS
 *   2. Clipboard   — fallback when URL scheme unavailable; copies the
 *      payload markdown for paste-into-app
 *   3. Share Sheet — Web Share API on supported platforms
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
  /** v0 / v0.5 = available in this slice; v1+ = label-only placeholder. */
  available: boolean;
  /** Short user-visible reason when `available` is false. */
  unavailableReason?: string;
  /** Drive the launch. Returns the outcome for telemetry + UI feedback. */
  launch(payload: RoomContextPayload): Promise<LaunchOutcome>;
};

/**
 * Shared prompt builder for all external LLM adapters.
 * Extracted in v0.5 so Claude Desktop, ChatGPT, and future adapters
 * share the same room-context shape with per-target sign-off.
 */
function buildExternalLLMPrompt(
  payload: RoomContextPayload,
  opts: { trailing?: string } = {}
): string {
  const sections: string[] = [];
  sections.push(`I'm working in an ANT room called "${payload.roomName}".`);
  if (payload.roomDescription) {
    sections.push(`Room context: ${payload.roomDescription}`);
  }
  if (payload.openAsksMarkdown) {
    sections.push(`Open asks in this room:\n${payload.openAsksMarkdown}`);
  }
  if (payload.linkedRooms?.length) {
    const rows = payload.linkedRooms.map((link) => {
      const direction = link.direction === 'outgoing' ? 'links to' : 'linked from';
      const label = link.title || link.roomName;
      return `- ${direction} **${label}** (${link.relationship}; room ${link.roomId})`;
    });
    sections.push(`Linked rooms:\n${rows.join('\n')}`);
  }
  if (payload.recentMessagesMarkdown) {
    sections.push(`Recent conversation:\n${payload.recentMessagesMarkdown}`);
  }
  sections.push(opts.trailing ?? `Please help me think about this.`);
  return sections.join('\n\n');
}

const buildClaudeDesktopPrompt = (payload: RoomContextPayload) =>
  buildExternalLLMPrompt(payload);

const claudeDesktopAdapter: ClientAdapter = {
  target: 'claude-desktop',
  label: 'Bring in Claude Desktop',
  available: true,
  async launch(payload) {
    const prompt = buildClaudeDesktopPrompt(payload);
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      try {
        const encoded = encodeURIComponent(prompt);
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `claude://new?text=${encoded}`;
        document.body.appendChild(iframe);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(prompt);
        }
        setTimeout(() => iframe.remove(), 1000);
        return {
          method: 'url-scheme',
          status: 'launched',
          message: 'Opening Claude Desktop. Prompt also copied to clipboard.'
        };
      } catch (cause) {
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

/**
 * ChatGPT adapter — v0.5.
 *
 * OpenAI does not expose a registered URL scheme for ChatGPT Desktop,
 * so this adapter is clipboard-only. The operator clicks the pill,
 * the prompt is copied to the clipboard, and they paste into ChatGPT.
 */
const chatgptAdapter: ClientAdapter = {
  target: 'chatgpt',
  label: 'Bring in ChatGPT',
  available: true,
  async launch(payload) {
    const prompt = buildExternalLLMPrompt(payload, {
      trailing: 'Could you help me think through this?'
    });
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(prompt);
          return {
            method: 'clipboard',
            status: 'launched',
            message: 'Prompt copied to clipboard. Open ChatGPT and paste to start.'
          };
        }
        return {
          method: 'clipboard',
          status: 'unavailable',
          message: 'Clipboard API unavailable in this browser.'
        };
      } catch (cause) {
        return {
          method: 'clipboard',
          status: 'unavailable',
          message: `Clipboard write failed: ${cause instanceof Error ? cause.message : 'unknown'}`
        };
      }
    }
    return {
      method: 'clipboard',
      status: 'unavailable',
      message: 'Browser environment unavailable.'
    };
  }
};

const claudeMobileAdapter: ClientAdapter = {
  target: 'claude-mobile',
  label: 'Bring in Claude Mobile',
  available: false,
  unavailableReason: 'iOS adapter ships in v1',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Claude Mobile adapter not in v0.5.' };
  }
};

const codexDesktopAdapter: ClientAdapter = {
  target: 'codex-desktop',
  label: 'Bring in Codex Desktop',
  available: false,
  unavailableReason: 'Codex Desktop adapter ships in v1',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Codex Desktop adapter not in v0.5.' };
  }
};

const geminiAdapter: ClientAdapter = {
  target: 'gemini',
  label: 'Bring in Gemini',
  available: false,
  unavailableReason: 'Gemini adapter ships in v1',
  async launch() {
    return { method: 'url-scheme', status: 'unavailable', message: 'Gemini adapter not in v0.5.' };
  }
};

export const BRING_IN_APP_ADAPTERS: ClientAdapter[] = [
  claudeDesktopAdapter,
  chatgptAdapter,
  claudeMobileAdapter,
  codexDesktopAdapter,
  geminiAdapter
];

export function findAdapter(target: BringInTarget): ClientAdapter | undefined {
  return BRING_IN_APP_ADAPTERS.find((a) => a.target === target);
}

// Re-export for tests; not the public API surface for callers.
export { buildClaudeDesktopPrompt as _buildClaudeDesktopPromptForTests };
export { buildExternalLLMPrompt as _buildExternalLLMPromptForTests };
