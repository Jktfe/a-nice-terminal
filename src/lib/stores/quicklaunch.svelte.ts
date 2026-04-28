/** Per-session quick-launch button configs, persisted in localStorage. */

export interface QuickLaunchButton {
  id: string;
  label: string;
  icon: string;       // emoji or short text
  command: string;     // the text sent on tap (e.g. "cd ~/projects/ant && claude")
  color?: string;      // optional accent colour hex
}

const STORAGE_KEY = 'ant:quick-launch';

function load(): Record<string, QuickLaunchButton[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, QuickLaunchButton[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

function mergeLocalButtons(current: QuickLaunchButton[], local: QuickLaunchButton[]): QuickLaunchButton[] {
  // User-edited buttons (already in current) take priority over server presets.
  // Only ADD server buttons that don't already exist by id or command.
  const currentIds = new Set(current.map((b) => b.id));
  const currentCommands = new Set(current.map((b) => b.command));
  const defaultIds = new Set(DEFAULTS.map((b) => b.id));

  // Remove stale defaults that the server presets replace
  const withoutStaleDefaults = current.filter((b) => !defaultIds.has(b.id));

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

/** Reactive store: returns buttons for a given session and mutation helpers. */
export function useQuickLaunch(sessionId: string, driver?: string | null) {
  const allData = load();
  let buttons = $state<QuickLaunchButton[]>(migrateButtons(allData[sessionId] ?? [...getDefaults(driver)]));
  let loadedLocalDefaults = false;

  function persist() {
    const allData = load();
    allData[sessionId] = buttons;
    save(allData);
  }

  return {
    get buttons() { return buttons; },

    add(btn: Omit<QuickLaunchButton, 'id'>) {
      buttons = [...buttons, { ...btn, id: genId() }];
      persist();
    },

    update(id: string, patch: Partial<Omit<QuickLaunchButton, 'id'>>) {
      buttons = buttons.map(b => b.id === id ? { ...b, ...patch } : b);
      persist();
    },

    remove(id: string) {
      buttons = buttons.filter(b => b.id !== id);
      persist();
    },

    reorder(fromIdx: number, toIdx: number) {
      const arr = [...buttons];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      buttons = arr;
      persist();
    },

    reset() {
      buttons = [...getDefaults(driver)];
      persist();
    },

    async loadLocalDefaults() {
      if (loadedLocalDefaults) return;
      loadedLocalDefaults = true;

      try {
        const res = await fetch('/api/quick-launch');
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data?.buttons) || data.buttons.length === 0) return;
        const localButtons = data.buttons.filter(isButton);
        if (localButtons.length === 0) return;
        buttons = mergeLocalButtons(buttons, localButtons);
        persist();
      } catch {
        // Local quick-launch presets are optional.
      }
    },
  };
}
