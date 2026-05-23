import { getIdentityDb } from './db';

export type ContextBreakEnforcement = 'off' | 'advisory' | 'hard';

const ALLOWED_ENFORCEMENT: readonly ContextBreakEnforcement[] = ['off', 'advisory', 'hard'];
const DEFAULT_ENFORCEMENT: ContextBreakEnforcement = 'hard';

export function isContextBreakEnforcement(value: unknown): value is ContextBreakEnforcement {
  return typeof value === 'string' && (ALLOWED_ENFORCEMENT as readonly string[]).includes(value);
}

export function getContextBreakEnforcement(roomId: string): ContextBreakEnforcement {
  const row = getIdentityDb()
    .prepare('SELECT context_break_enforcement FROM chat_rooms WHERE id = ?')
    .get(roomId) as { context_break_enforcement: string | null } | undefined;

  return isContextBreakEnforcement(row?.context_break_enforcement)
    ? row.context_break_enforcement
    : DEFAULT_ENFORCEMENT;
}

export function setContextBreakEnforcement(
  roomId: string,
  enforcement: ContextBreakEnforcement
): ContextBreakEnforcement {
  if (!isContextBreakEnforcement(enforcement)) {
    throw new Error('Unknown context-break enforcement mode.');
  }

  getIdentityDb()
    .prepare('UPDATE chat_rooms SET context_break_enforcement = ? WHERE id = ?')
    .run(enforcement, roomId);

  return getContextBreakEnforcement(roomId);
}

export function resetContextBreakSettingsForTests(): void {
  getIdentityDb().prepare("UPDATE chat_rooms SET context_break_enforcement = 'hard'").run();
}
