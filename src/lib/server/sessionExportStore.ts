import { listMessagesInRoom, type ChatMessage } from './chatMessageStore';
import { findChatRoomById, type ChatRoom } from './chatRoomStore';
import { getTerminalRecord, type TerminalRecord } from './terminalRecordsStore';

export const SESSION_EXPORT_FORMATS = ['markdown', 'json', 'text'] as const;

export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number];

export type SessionExportResult = {
  session: {
    id: string;
    name: string | null;
    agentKind: string | null;
    handle: string | null;
  };
  room: {
    id: string;
    name: string;
  };
  resolvedFrom: 'terminal' | 'room';
  exportedAt: string;
  messageCount: number;
  messages: ChatMessage[];
  format: SessionExportFormat;
  contentType: string;
  filename: string;
  body: string;
};

function isSessionExportFormat(value: string): value is SessionExportFormat {
  return (SESSION_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function parseSessionExportFormat(raw: string | null | undefined): SessionExportFormat {
  if (!raw || raw.trim().length === 0) return 'markdown';
  const normalized = raw.trim().toLowerCase();
  if (!isSessionExportFormat(normalized)) {
    throw new Error(`Unsupported export format "${raw}". Use markdown, json, or text.`);
  }
  return normalized;
}

function resolveSessionTarget(sessionId: string): {
  terminal: TerminalRecord | null;
  room: ChatRoom;
  resolvedFrom: 'terminal' | 'room';
} {
  const terminal = getTerminalRecord(sessionId);
  if (terminal?.linked_chat_room_id) {
    const linkedRoom = findChatRoomById(terminal.linked_chat_room_id);
    if (linkedRoom) return { terminal, room: linkedRoom, resolvedFrom: 'terminal' };
  }

  const directRoom = findChatRoomById(sessionId);
  if (directRoom) return { terminal: null, room: directRoom, resolvedFrom: 'room' };

  throw new Error(`No session or room found for id ${sessionId}.`);
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'session';
}

function contentTypeFor(format: SessionExportFormat): string {
  if (format === 'json') return 'application/json; charset=utf-8';
  if (format === 'text') return 'text/plain; charset=utf-8';
  return 'text/markdown; charset=utf-8';
}

function extensionFor(format: SessionExportFormat): string {
  if (format === 'json') return 'json';
  if (format === 'text') return 'txt';
  return 'md';
}

function jsonPayload(input: {
  sessionId: string;
  terminal: TerminalRecord | null;
  room: ChatRoom;
  resolvedFrom: 'terminal' | 'room';
  exportedAt: string;
  messages: ChatMessage[];
}) {
  return {
    kind: 'session-export',
    session: {
      id: input.sessionId,
      name: input.terminal?.name ?? null,
      agentKind: input.terminal?.agent_kind ?? null,
      handle: input.terminal?.handle ?? null
    },
    room: {
      id: input.room.id,
      name: input.room.name
    },
    resolvedFrom: input.resolvedFrom,
    exportedAt: input.exportedAt,
    messageCount: input.messages.length,
    messages: input.messages
  };
}

function renderJson(payload: ReturnType<typeof jsonPayload>): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderMarkdown(payload: ReturnType<typeof jsonPayload>): string {
  const lines = [
    `# ${payload.room.name}`,
    '',
    `- Session: ${payload.session.id}`,
    `- Room: ${payload.room.id}`,
    `- Resolved from: ${payload.resolvedFrom}`,
    `- Exported: ${payload.exportedAt}`,
    `- Messages: ${payload.messageCount}`,
    ''
  ];
  for (const message of payload.messages) {
    lines.push(`## ${message.postedAt} ${message.authorHandle}`);
    lines.push('');
    lines.push(`**${message.authorHandle}**: ${message.body}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderText(payload: ReturnType<typeof jsonPayload>): string {
  const lines = [
    `${payload.room.name}`,
    `Session: ${payload.session.id}`,
    `Room: ${payload.room.id}`,
    `Resolved from: ${payload.resolvedFrom}`,
    `Exported: ${payload.exportedAt}`,
    `Messages: ${payload.messageCount}`,
    ''
  ];
  for (const message of payload.messages) {
    lines.push(`[${message.postedAt}] ${message.authorHandle}: ${message.body}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function exportSession(input: {
  sessionId: string;
  format?: SessionExportFormat;
  exportedAt?: string;
}): SessionExportResult {
  const format = input.format ?? 'markdown';
  const { terminal, room, resolvedFrom } = resolveSessionTarget(input.sessionId);
  const messages = listMessagesInRoom(room.id);
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const payload = jsonPayload({
    sessionId: input.sessionId,
    terminal,
    room,
    resolvedFrom,
    exportedAt,
    messages
  });
  const body =
    format === 'json'
      ? renderJson(payload)
      : format === 'text'
        ? renderText(payload)
        : renderMarkdown(payload);

  return {
    ...payload,
    format,
    contentType: contentTypeFor(format),
    filename: `${slug(room.name)}-${room.id}.${extensionFor(format)}`,
    body
  };
}
