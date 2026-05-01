const AUTO_LINKED_TERMINAL_ID_KEY = 'auto_linked_terminal_id';

function parseSessionMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return meta && typeof meta === 'object' ? meta as Record<string, unknown> : {};
}

export function autoLinkedTerminalId(session: { meta?: unknown } | null | undefined): string | null {
  const value = parseSessionMeta(session?.meta)[AUTO_LINKED_TERMINAL_ID_KEY];
  return typeof value === 'string' && value ? value : null;
}

export function isAutoLinkedChatSession(session: { type?: string; meta?: unknown } | null | undefined): boolean {
  return session?.type === 'chat' && autoLinkedTerminalId(session) !== null;
}

import type { ShortcutScope } from '$lib/shared/personal-settings';

/**
 * Decide which QuickLaunchBar scope applies to a session.
 *
 * - `linkedChats` for terminal sessions and chat sessions paired with a terminal
 *   (auto-linked or pointed-to by another terminal's `linked_chat_id`).
 * - `chatrooms` for multi-participant chat sessions that aren't paired.
 * - `null` for everything else (no quick-action bar shown).
 */
export function shortcutScopeFor(
  session: { type?: string; id?: string; meta?: unknown } | null | undefined,
  allSessions: { type?: string; linked_chat_id?: string | null }[] = [],
): ShortcutScope | null {
  if (!session) return null;
  if (session.type === 'terminal') return 'linkedChats';
  if (session.type !== 'chat') return null;
  if (isAutoLinkedChatSession(session)) return 'linkedChats';
  const pointedToByTerminal = allSessions.some(
    (s) => s.type === 'terminal' && s.linked_chat_id === session.id,
  );
  return pointedToByTerminal ? 'linkedChats' : 'chatrooms';
}
