/** Per-session quick-launch button configs, persisted in localStorage. */
import { browser } from '$app/environment';

export interface QuickLaunchButton {
  id: string;
  label: string;
  icon: string;       // emoji or short text
  command: string;     // the text sent on tap (e.g. "cd ~/projects/ant && claude")
  color?: string;      // optional accent colour hex
}

const STORAGE_KEY = 'ant:quick-launch';

function load(): Record<string, QuickLaunchButton[]> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, QuickLaunchButton[]>) {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function hasOwn(data: Record<string, QuickLaunchButton[]>, sessionId: string) {
  return Object.prototype.hasOwnProperty.call(data, sessionId);
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Default buttons shown for new sessions ──
const DEFAULTS: QuickLaunchButton[] = [
  { id: 'default-1', label: 'Claude Code', icon: '🤖', command: 'claude --dangerously-skip-permissions --remote-control', color: '#6366F1' },
  { id: 'default-2', label: 'ANT Project', icon: '🐜', command: 'cd $ANT_PROJECT_DIR', color: '#10B981' },
];

function getDefaults(_driver?: string | null): QuickLaunchButton[] {
  return [...DEFAULTS];
}

function isButton(value: any): value is QuickLaunchButton {
  return value
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.icon === 'string'
    && typeof value.command === 'string';
}

function sameButton(a: QuickLaunchButton, b: QuickLaunchButton) {
  return a.id === b.id
    && a.label === b.label
    && a.icon === b.icon
    && a.command === b.command
    && (a.color ?? '') === (b.color ?? '');
}

function isUntouchedDefault(button: QuickLaunchButton) {
  return DEFAULTS.some((defaultButton) => sameButton(button, defaultButton));
}

function mergeLocalButtons(current: QuickLaunchButton[], local: QuickLaunchButton[]): QuickLaunchButton[] {
  // User-edited buttons take priority over server presets. Only replace stock
  // defaults that are still untouched; default IDs alone are not enough because
  // edited defaults keep their original IDs.
  const withoutStaleDefaults = current.filter((b) => !isUntouchedDefault(b));
  const currentIds = new Set(withoutStaleDefaults.map((b) => b.id));
  const currentCommands = new Set(withoutStaleDefaults.map((b) => b.command));

  // Add server buttons that aren't already present
  const newFromServer = local.filter((b) =>
    !currentIds.has(b.id) && !currentCommands.has(b.command)
  );

  return migrateButtons([...withoutStaleDefaults, ...newFromServer]);
}

function migrateButtons(buttons: QuickLaunchButton[]): QuickLaunchButton[] {
  return buttons.map((button) => {
    if (button.id === 'default-1' && button.label === 'Claude Code' && button.command === 'claude') {
      return { ...button, command: DEFAULTS[0].command };
    }
    return button;
  });
}

type QuickLaunchState = {
  buttons: QuickLaunchButton[];
  loadedLocalDefaults: boolean;
  hasSavedSession: boolean;
};

const states = new Map<string, QuickLaunchState>();

function getState(sessionId: string, driver?: string | null) {
  const existing = browser ? states.get(sessionId) : null;
  if (existing) return existing;

  const allData = load();
  const hasSavedSession = hasOwn(allData, sessionId);
  const savedButtons = hasSavedSession && Array.isArray(allData[sessionId])
    ? allData[sessionId]
    : null;
  const state = $state<QuickLaunchState>({
    buttons: migrateButtons(savedButtons ?? [...getDefaults(driver)]),
    loadedLocalDefaults: false,
    hasSavedSession,
  });
  if (browser) states.set(sessionId, state);
  return state;
}

/** Reactive store: returns buttons for a given session and mutation helpers. */
export function useQuickLaunch(sessionId: string, driver?: string | null) {
  const state = getState(sessionId, driver);

  function persist() {
    const allData = load();
    allData[sessionId] = state.buttons;
    save(allData);
    state.hasSavedSession = true;
  }

  return {
    get buttons() { return state.buttons; },

    add(btn: Omit<QuickLaunchButton, 'id'>) {
      state.buttons = [...state.buttons, { ...btn, id: genId() }];
      persist();
    },

    update(id: string, patch: Partial<Omit<QuickLaunchButton, 'id'>>) {
      state.buttons = state.buttons.map(b => b.id === id ? { ...b, ...patch } : b);
      persist();
    },

    remove(id: string) {
      state.buttons = state.buttons.filter(b => b.id !== id);
      persist();
    },

    reorder(fromIdx: number, toIdx: number) {
      const arr = [...state.buttons];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      state.buttons = arr;
      persist();
    },

    reset() {
      state.buttons = [...getDefaults(driver)];
      persist();
    },

    async loadLocalDefaults() {
      if (state.loadedLocalDefaults || state.hasSavedSession) return;
      state.loadedLocalDefaults = true;

      try {
        const res = await fetch('/api/quick-launch');
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data?.buttons) || data.buttons.length === 0) return;
        const localButtons = data.buttons.filter(isButton);
        if (localButtons.length === 0) return;
        state.buttons = mergeLocalButtons(state.buttons, localButtons);
        persist();
      } catch {
        // Local quick-launch presets are optional.
      }
    },
  };
}
