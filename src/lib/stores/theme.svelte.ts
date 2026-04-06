const STORAGE_KEY = 'ant-theme';

function createThemeStore() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  let dark = $state(stored !== 'light');

  function apply(isDark: boolean) {
    const html = document.documentElement;
    html.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }

  function toggle() {
    dark = !dark;
    apply(dark);
  }

  function init() {
    apply(dark);
  }

  return {
    get dark() { return dark; },
    toggle,
    init,
  };
}

export const theme = createThemeStore();
