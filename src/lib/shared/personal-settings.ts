export const SHORTCUT_SCOPES = ['chatrooms', 'linkedChats'] as const;

export type ShortcutScope = typeof SHORTCUT_SCOPES[number];

export interface PersonalShortcut {
  id: string;
  label: string;
  icon: string;
  command: string;
  color: string;
}

export interface PersonalSettings {
  shortcuts: Record<ShortcutScope, PersonalShortcut[]>;
  preferences: Record<string, unknown>;
}

const SEED_CHATROOMS: PersonalShortcut[] = [
  { id: 'seed-chat-ack',  label: 'Ack',     icon: '👍', command: 'Got it 👍', color: '#10B981' },
  { id: 'seed-chat-done', label: 'Done',    icon: '✅', command: 'Done — over to you.', color: '#0EA5E9' },
  { id: 'seed-chat-tag',  label: 'Tag',     icon: '🙋', command: '@everyone ', color: '#F59E0B' },
  { id: 'seed-chat-hand', label: 'Hand-off', icon: '🤝', command: 'Handing this to: ', color: '#8B5CF6' },
];

const SEED_LINKED: PersonalShortcut[] = [
  { id: 'seed-link-claude', label: 'Claude',  icon: '🤖', command: 'claude --dangerously-skip-permissions --remote-control', color: '#6366F1' },
  { id: 'seed-link-cd',     label: 'cd ANT',  icon: '🐜', command: 'cd $ANT_PROJECT_DIR', color: '#10B981' },
  { id: 'seed-link-tests',  label: 'Tests',   icon: '🧪', command: 'bun test', color: '#0891B2' },
  { id: 'seed-link-status', label: 'Status',  icon: '🌳', command: 'git status', color: '#D97706' },
];

export function createDefaultPersonalSettings(): PersonalSettings {
  return {
    shortcuts: {
      chatrooms: SEED_CHATROOMS.map((s) => ({ ...s })),
      linkedChats: SEED_LINKED.map((s) => ({ ...s })),
    },
    preferences: {},
  };
}

export function shortcutScopeLabel(scope: ShortcutScope): string {
  return scope === 'chatrooms' ? 'Chatrooms' : 'Linked Chats';
}

export function isPersonalShortcut(value: unknown): value is PersonalShortcut {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.label === 'string'
    && typeof v.icon === 'string'
    && typeof v.command === 'string'
    && typeof v.color === 'string';
}
