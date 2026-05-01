import { browser } from '$app/environment';
import {
  SHORTCUT_SCOPES,
  createDefaultPersonalSettings,
  isPersonalShortcut,
  type PersonalSettings,
  type PersonalShortcut,
  type ShortcutScope,
} from '$lib/shared/personal-settings';

type PersonalSettingsState = {
  settings: PersonalSettings;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  path: string | null;
};

const state = $state<PersonalSettingsState>({
  settings: createDefaultPersonalSettings(),
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  path: null,
});

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function cloneSettings(settings: PersonalSettings): PersonalSettings {
  return {
    shortcuts: {
      chatrooms: [...(settings.shortcuts.chatrooms ?? [])],
      linkedChats: [...(settings.shortcuts.linkedChats ?? [])],
    },
    preferences: { ...(settings.preferences ?? {}) },
  };
}

function normalise(settings: unknown): PersonalSettings {
  const defaults = createDefaultPersonalSettings();
  const value = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Partial<PersonalSettings>
    : null;

  // No on-disk record yet → seed both scopes with starter chips.
  if (!value || !value.shortcuts) return defaults;

  const shortcuts = typeof value.shortcuts === 'object'
    ? value.shortcuts as Partial<Record<ShortcutScope, unknown[]>>
    : {};

  for (const scope of SHORTCUT_SCOPES) {
    const raw = Array.isArray(shortcuts[scope]) ? shortcuts[scope] as unknown[] : [];
    // Drop legacy navigation-style entries (PersonalShortcut.sessionId from the
    // retired GlobalShortcutsMenu); only keep entries with a `command` field.
    defaults.shortcuts[scope] = raw.filter(isPersonalShortcut).map((s) => ({ ...s }));
  }

  defaults.preferences = value.preferences && typeof value.preferences === 'object' && !Array.isArray(value.preferences)
    ? { ...value.preferences }
    : {};

  return defaults;
}

async function persist(settings = state.settings) {
  if (!browser) return;
  state.saving = true;
  state.error = null;

  try {
    const res = await fetch('/api/personal-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save personal settings');
    state.settings = normalise(data.settings);
    state.path = typeof data.path === 'string' ? data.path : state.path;
    state.loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Failed to save personal settings';
  } finally {
    state.saving = false;
  }
}

async function load(force = false) {
  if (!browser || state.loading || (state.loaded && !force)) return;
  state.loading = true;
  state.error = null;

  try {
    const res = await fetch('/api/personal-settings');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to load personal settings');
    state.settings = normalise(data.settings);
    state.path = typeof data.path === 'string' ? data.path : null;
    state.loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Failed to load personal settings';
  } finally {
    state.loading = false;
  }
}

export function usePersonalSettings() {
  return {
    get settings() { return state.settings; },
    get loaded() { return state.loaded; },
    get loading() { return state.loading; },
    get saving() { return state.saving; },
    get error() { return state.error; },
    get path() { return state.path; },

    load,
    save: persist,

    addShortcut(scope: ShortcutScope, shortcut: Omit<PersonalShortcut, 'id'>) {
      const next = cloneSettings(state.settings);
      next.shortcuts[scope] = [...next.shortcuts[scope], { ...shortcut, id: genId() }];
      state.settings = next;
      void persist(next);
    },

    updateShortcut(scope: ShortcutScope, id: string, patch: Partial<Omit<PersonalShortcut, 'id'>>) {
      const next = cloneSettings(state.settings);
      next.shortcuts[scope] = next.shortcuts[scope].map((shortcut) =>
        shortcut.id === id ? { ...shortcut, ...patch } : shortcut
      );
      state.settings = next;
      void persist(next);
    },

    removeShortcut(scope: ShortcutScope, id: string) {
      const next = cloneSettings(state.settings);
      next.shortcuts[scope] = next.shortcuts[scope].filter((shortcut) => shortcut.id !== id);
      state.settings = next;
      void persist(next);
    },

    moveShortcut(scope: ShortcutScope, fromIndex: number, toIndex: number) {
      const next = cloneSettings(state.settings);
      const list = [...next.shortcuts[scope]];
      if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
      next.shortcuts[scope] = list;
      state.settings = next;
      void persist(next);
    },

    setShortcuts(scope: ShortcutScope, shortcuts: PersonalShortcut[]) {
      const next = cloneSettings(state.settings);
      next.shortcuts[scope] = shortcuts;
      state.settings = next;
      void persist(next);
    },

    updatePreferences(preferences: Record<string, unknown>) {
      const next = cloneSettings(state.settings);
      next.preferences = preferences;
      state.settings = next;
      void persist(next);
    },
  };
}
