/**
 * fresh-ANT theme store — NAV-POLISH 2026-05-14.
 *
 * Reads localStorage + prefers-color-scheme on init, toggles
 * `data-theme="dark"` on <html>, persists user choice.
 *
 * Why Svelte 5 $state: we want the value reactive in the top-bar
 * button label, and a $state class export is the lightweight
 * idiom for a singleton this small.
 */
const STORAGE_KEY = 'ant-theme';

class ThemeStore {
  isDark = $state(false);

  init() {
    if (typeof document === 'undefined') return;
    const stored = localStorage.getItem(STORAGE_KEY);
    let initial: 'light' | 'dark';
    if (stored === 'dark' || stored === 'light') {
      initial = stored;
    } else {
      initial = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    this.apply(initial);
  }

  toggle() {
    this.apply(this.isDark ? 'light' : 'dark');
  }

  private apply(value: 'light' | 'dark') {
    this.isDark = value === 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = value;
      try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ }
    }
  }
}

export const theme = new ThemeStore();
