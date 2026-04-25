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
