const STORAGE_KEY = 'ant-theme';

function createThemeStore() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  let dark = $state(stored === 'dark');

  function apply(isDark: boolean) {
    const html = document.documentElement;
    if (isDark) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
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
