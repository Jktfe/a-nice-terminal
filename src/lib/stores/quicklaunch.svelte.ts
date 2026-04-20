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
  { id: 'default-1', label: 'Claude Code', icon: '🤖', command: 'claude', color: '#6366F1' },
  { id: 'default-2', label: 'ANT Project', icon: '🐜', command: 'cd ~/CascadeProjects/a-nice-terminal', color: '#10B981' },
];

/** Reactive store: returns buttons for a given session and mutation helpers. */
export function useQuickLaunch(sessionId: string) {
  const allData = load();
  let buttons = $state<QuickLaunchButton[]>(allData[sessionId] ?? [...DEFAULTS]);

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
      buttons = [...DEFAULTS];
      persist();
    },
  };
}
