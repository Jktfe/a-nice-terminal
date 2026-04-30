export const SHORTCUT_SCOPES = ['chatrooms', 'linkedChats'] as const;

export type ShortcutScope = typeof SHORTCUT_SCOPES[number];

export interface PersonalShortcut {
  id: string;
  label: string;
  icon: string;
  sessionId: string;
  color: string;
}

export interface PersonalSettings {
  shortcuts: Record<ShortcutScope, PersonalShortcut[]>;
  preferences: Record<string, unknown>;
}

export function createDefaultPersonalSettings(): PersonalSettings {
  return {
    shortcuts: {
      chatrooms: [],
      linkedChats: [],
    },
    preferences: {},
  };
}

export function shortcutScopeLabel(scope: ShortcutScope): string {
  return scope === 'chatrooms' ? 'Chatrooms' : 'Linked Chats';
}
