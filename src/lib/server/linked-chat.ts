const AUTO_LINKED_TERMINAL_ID_KEY = 'auto_linked_terminal_id';

type SessionMeta = Record<string, unknown>;

function parseSessionMeta(meta: unknown): SessionMeta {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' ? (parsed as SessionMeta) : {};
    } catch {
      return {};
    }
  }
  return meta && typeof meta === 'object' ? (meta as SessionMeta) : {};
}

export function buildAutoLinkedChatMeta(terminalId: string) {
  return {
    [AUTO_LINKED_TERMINAL_ID_KEY]: terminalId,
    auto_named: true,
  };
}

export function isAutoLinkedChatForTerminal(meta: unknown, terminalId: string) {
  const parsed = parseSessionMeta(meta);
  return parsed[AUTO_LINKED_TERMINAL_ID_KEY] === terminalId;
}
