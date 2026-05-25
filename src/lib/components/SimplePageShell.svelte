<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import AntLogo from './AntLogo.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { agentKinds } from '$lib/stores/agentKinds.svelte';
  import { terminalBookmarks } from '$lib/stores/terminalBookmarks.svelte';

  import { toggleExplainMode } from '$lib/stores/explainMode.svelte';
  type Props = {
    eyebrow?: string;
    title?: string;
    summary?: string;
    showIntro?: boolean;
    statusPill?: Snippet;
    children?: Snippet;
  };

  let { eyebrow = '', title = '', summary = '', showIntro = true, statusPill, children }: Props = $props();
  let navOpen = $state(false);

  onMount(() => {
    theme.init(); agentKinds.init(); terminalBookmarks.init();
    window.addEventListener('keydown', handleExplainKey);
    return () => window.removeEventListener('keydown', handleExplainKey);
  });

  function handleExplainKey(e: KeyboardEvent) {
    if (e.key !== '?' || !e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
    e.preventDefault();
    toggleExplainMode();
  }

  // a11y: derive whether each nav link points at the current page so
  // we can stamp aria-current="page" and a visible "active" class. A
  // route counts as active if the pathname matches exactly or starts
  // with the link's href + "/". The try/catch keeps SSR-only tests
  // happy when they render this shell outside a real page context —
  // `page.url` throws if nothing has bound the request scope.
  const currentPath = $derived.by(() => {
    try { return page.url?.pathname ?? '/'; }
    catch { return '/'; }
  });
  function isActive(href: string): boolean {
    if (href === '/') return currentPath === '/';
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }
</script>

<main id="main-content" class="simple-page">
  <header>
    <a href="/" class="brand" aria-label="Back to dashboard">
      <AntLogo />
    </a>
    <button
      type="button"
      class="nav-toggle"
      aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={navOpen}
      onclick={() => (navOpen = !navOpen)}
    >
      <span></span>
      <span></span>
      <span></span>
    </button>
    <nav aria-label="Primary" class:open={navOpen}>
      <a href="/" title="Dashboard" aria-label="Dashboard" class:active={isActive('/')} aria-current={isActive('/') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <!-- Analyze (magnifier + bar chart) — per JWPK msg_s41ht39fpu, sourced from /Users/jamesking/Downloads/analyze.svg. -->
        <svg viewBox="0 0 512 512" aria-hidden="true">
          <g transform="translate(42.666667, 64.000000)" fill="currentColor"><path d="M266.666667,128 C331.468077,128 384,180.531923 384,245.333333 C384,270.026519 376.372036,292.938098 363.343919,311.840261 L423.228475,371.725253 L393.058586,401.895142 L333.173594,342.010585 C314.271431,355.038703 291.359852,362.666667 266.666667,362.666667 C201.865256,362.666667 149.333333,310.134744 149.333333,245.333333 C149.333333,180.531923 201.865256,128 266.666667,128 Z M266.666667,170.666667 C225.429405,170.666667 192,204.096072 192,245.333333 C192,286.570595 225.429405,320 266.666667,320 C307.903928,320 341.333333,286.570595 341.333333,245.333333 C341.333333,204.096072 307.903928,170.666667 266.666667,170.666667 Z M128.404239,234.665576 C128.136379,238.186376 128,241.743928 128,245.333333 C128,256.34762 129.284152,267.061976 131.710904,277.334851 L0,277.333333 L0,234.666667 L128.404239,234.665576 Z M85.3333333,0 L85.3333333,213.333333 L21.3333333,213.333333 L21.3333333,0 L85.3333333,0 Z M170.666667,85.3333333 L170.663947,145.273483 C151.733734,163.440814 137.948238,186.928074 131.710904,213.331815 L106.666667,213.333333 L106.666667,85.3333333 L170.666667,85.3333333 Z M256,42.6666667 L255.999596,107.070854 C232.554315,108.854436 210.738728,116.46829 191.999452,128.465799 L192,42.6666667 L256,42.6666667 Z M341.333333,64 L341.333983,128.465865 C322.594868,116.468435 300.779487,108.854588 277.334424,107.070906 L277.333333,64 L341.333333,64 Z"/></g>
        </svg>
        <span class="nav-label">Dashboard</span>
      </a>
      <a href="/rooms" title="Rooms" aria-label="Rooms" class:active={isActive('/rooms')} aria-current={isActive('/rooms') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12l9-7 9 7v8a1 1 0 01-1 1h-5v-6H10v6H4a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        <span class="nav-label">Rooms</span>
      </a>
      <a href="/terminals" title="Terminals" aria-label="Terminals" class:active={isActive('/terminals')} aria-current={isActive('/terminals') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l5 6-5 6M12 18h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="nav-label">Terminals</span>
      </a>
      <a href="/agents" title="Agents" aria-label="Agents" class:active={isActive('/agents')} aria-current={isActive('/agents') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 150 150" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="m6.3 2.3v145.6h137.5v-145.5l-137.5-0.1zm127.2 68.3h-35.6v8.3h35.6v58.6h-54.6c-0.1-0.6-0.1-28.2 0-28.3h-8.4v28.3h-54v-58.6h35.3v-8.3h-35.3c-0.1-0.7-0.1-58.1 0-58.2h54v28h8.4v-28h54.6v58.2zm-96.1-38.2v23.8l-6.5 0.1v-30h25.3v6.1h-18.8zm-14.9-14.1v46.3h29.3v-8.3h-6.2l-0.1-15.9h19v-22.1h-42zm62.6 0v22l18.8 0.1v5.3l-6 0.1c-0.1 0.5 0 18.6 0 18.8h8.3v-14.9h6.4v-17.3h-18.9v-6.1h24.7v29.9l-5.9 0.1v8.3h14.7v-46.2l-42.1-0.1zm12.7 66.6 0.1 8h6v16.3h-18.8v8.3l27.5 0.1v-0.1-24.6h5.8v30.4h-33.3v8.3h42.1v-46.7h-29.4zm-54.6 0 0.1 14h-6v18.7h18.9v5.7h-25.3v-30.4h6.5v-8h-14.9v46.7h42v-22.4h-19v-6.2h6.3v-18.1h-8.6zm49 1c-0.6-0.9-4.4-9.3-5.9-10.2l-7.5-1.7c0-3.4-0.4-4.2 1-4.8 1.9-1 5.9-3 6.3-3.9 0.3-0.6 2.6-10.8 2.8-11.7 0.2-1.4-1.3-2.1-2-0.8-0.3 0.8-2.9 10.8-2.9 10.8-1.9 1-4 2.2-5.4 3.1-1.3-1.2-1.7-1.6-1.7-3.5 1.6-0.8 3.1-2 3.2-4.8-0.2-1.9-1.3-3.5-2.4-4.4 0.8-1 2.7-2.9 3.5-3.8 0.5-1 3-2.8 3-3.7 0.1-1.1-1-1.9-2.1-0.4-0.7 0.7-2.2 2.5-2.2 2.7-0.5 0.4-2.7 2.7-3.3 4.4-1.2-0.6-2.8-0.6-4.4-0.1-0.8-1.5-3.6-4-3.7-4.5-2.1-2.5-3-4.3-4.1-3.3-0.6 0.9 0.4 1.3 3 3.8 0.7 1 3.4 3.4 3.6 4.8-1 0.7-2.2 2.4-2.1 4.1 0.3 3.4 2.4 4.4 3.2 5.1 0 1.8-0.3 2-1.7 3.6-1.5-0.9-3.6-2.2-5.4-3.1 0 0-2.4-10.2-3.1-11.2-0.5-0.8-2.1-0.3-1.7 1.2 0.3 1.5 2.6 10.6 3.2 11.3 0.7 0.7 5 3 6.1 3.7 1.1 0.8 0.7 2.4 0.7 5.4-6.4 1.5-7.7 1.4-7.8 2.3-0.8 0.8-4.6 8.6-5.5 10-0.5 1.3 1 2.5 1.9 1.1l5.3-10c2.4-0.3 5.7-0.5 7-1.2 1.1 1.2 0.8 0.9 0.7 2.8 0 0.4-8.3 6.1-9.2 7.5-0.8 1.4-2.1 10.4-2.2 10.9-1.6 2.8-3.3 3.8-1.6 4.7 0.8 0.3 1 0.3 1.6-0.5 0.7-1 2.1-3 2.2-3.9l1.5-10 3.1-1.9c-0.4 4.3 0.2 10.1 5 14.1 0.7 0.6 1.8 1.7 2.6 1.7 1.2 0 4.1-2.2 5.3-4.2 1.8-3 2.1-6.9 1.5-11.7l3.2 2 1.6 9.9c0.4 0.9 2.2 3.4 2.8 4.3 0.8 0.7 2.6 0 1.7-1.4-0.5-0.6-2-2.9-2-3.1 0-0.9-1.5-9.8-2.1-10.9-0.7-1.3-8.8-6.9-9.4-7.4-0.5-2.2-0.3-2.2 0.5-3 1 0.4 3 0.8 6.9 1.3 1.2 1.6 5.1 9.7 6 10.5 0.8 0.6 2.4-0.5 1.4-2z" fill="currentColor"/></svg>
        <span class="nav-label">Agents</span>
      </a>
      <a href="/plans" title="Plans" aria-label="Plans" class:active={isActive('/plans')} aria-current={isActive('/plans') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <!-- Gauge/speedometer — per JWPK msg_s41ht39fpu, the previous Dashboard glyph now lands on Plans
             (visual ambiguity cleanup: Plans IS a progress-gauge surface; Dashboard becomes 'analyze'). -->
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16a9 9 0 1 1 18 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16l5-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.6" fill="currentColor"/><path d="M8 19h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="nav-label">Plans</span>
      </a>
      <a href="/discover" title="CLI manifest" aria-label="CLI manifest" class:active={isActive('/discover')} aria-current={isActive('/discover') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 19a2 2 0 0 0 2 2h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 7h7M9 11h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="nav-label">CLI</span>
      </a>
      <a href="/search" title="Search across rooms" aria-label="Search across rooms" class:active={isActive('/search')} aria-current={isActive('/search') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="nav-label">Search</span>
      </a>
      <a href="/diagnostics" title="Diagnostics" aria-label="Diagnostics" class:active={isActive('/diagnostics')} aria-current={isActive('/diagnostics') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="nav-label">Diagnostics</span>
      </a>
      <a href="/settings" title="Settings (preferences, identity, plugins, tools, skills, data, system, activity)" aria-label="Settings" class:active={isActive('/settings')} aria-current={isActive('/settings') ? 'page' : undefined} onclick={() => (navOpen = false)}>
        <!-- Gear icon (distinct from the sun-rays theme toggle).
             Outer cog with 8 teeth + central spindle hole. -->
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.6a7.8 7.8 0 0 0 0-3.2l2-1.5-2-3.5-2.4.9a7.7 7.7 0 0 0-2.8-1.6L13.7 2h-4l-.4 2.7A7.7 7.7 0 0 0 6.4 6.3L4 5.4l-2 3.5 2 1.5a7.8 7.8 0 0 0 0 3.2l-2 1.5 2 3.5 2.4-.9a7.7 7.7 0 0 0 2.8 1.6l.4 2.7h4l.4-2.7a7.7 7.7 0 0 0 2.8-1.6l2.4.9 2-3.5-2-1.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        <span class="nav-label">Settings</span>
      </a>
    </nav>
    <button type="button" class="theme-toggle" onclick={() => theme.toggle()} aria-label="Toggle theme" title={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {#if theme.isDark}
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></g></svg>
        <span class="nav-label">Light</span>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a8 8 0 11-9.5-9.5 7 7 0 009.5 9.5z" fill="currentColor"/></svg>
        <span class="nav-label">Dark</span>
      {/if}
    </button>
  </header>

  {#if showIntro}
    <section class="intro">
      {#if statusPill}
        <div class="intro-status">{@render statusPill()}</div>
      {/if}
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{summary}</span>
    </section>
  {/if}

  {@render children?.()}
</main>

<style>
  .simple-page {
    /* JWPK msg_r2qkxstx6k (2026-05-18): "I really want the width sorted
       so I get maximum text on my screen". Cap was 1120px which on a
       1920px display left ~46% of the viewport unused either side. The
       new cap scales up to 1680px on wide viewports while keeping the
       mobile/medium constraint untouched (the calc(100vw - 2rem) clamp
       still wins below ~1700px). Companion to the upcoming side-panel
       work — even before rails ship, the chat column gets significantly
       more horizontal room on desktop. */
    width: min(1680px, calc(100vw - 2rem));
    margin: 0 auto;
    padding: 1rem 0 4rem;
  }

  header {
    position: sticky;
    top: 0.65rem;
    z-index: 30;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.55rem;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
    background: rgb(255 255 255 / 82%);
    box-shadow: 0 10px 30px rgb(27 20 12 / 8%);
    backdrop-filter: blur(18px);
  }

  .brand {
    flex: 0 0 auto;
    text-decoration: none;
  }

  nav {
    margin-left: auto;
    display: flex;
    flex-wrap: nowrap;
    gap: 0.35rem;
  }

  nav a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.35rem;
    height: 2.35rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-weight: 800;
    text-decoration: none;
  }
  nav a:hover { border-color: var(--accent); color: var(--accent); }
  /* a11y: visible current-page state. Pairs with aria-current="page"
     for screen reader callouts; the colour swap is for sighted users. */
  nav a.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-card));
    color: var(--accent);
  }
  /* Focus ring for keyboard users — visible focus is required for WCAG
     2.4.7. Tab through the nav and each link gets a clear accent ring. */
  nav a:focus-visible,
  .nav-toggle:focus-visible,
  .theme-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  nav svg, .theme-toggle svg {
    width: 1.05rem;
    height: 1.05rem;
    flex-shrink: 0;
  }

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.35rem;
    height: 2.35rem;
    padding: 0;
    border: 1px solid var(--accent);
    border-radius: 0.65rem;
    background: var(--accent);
    color: white;
    font-weight: 800;
    cursor: pointer;
  }
  .nav-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .nav-toggle {
    display: none;
    width: 2.35rem;
    height: 2.35rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    cursor: pointer;
  }
  .nav-toggle span {
    display: block;
    width: 1.1rem;
    height: 2px;
    margin: 0.17rem auto;
    border-radius: 999px;
    background: currentColor;
  }

  :global(:root[data-theme='dark']) .theme-toggle { color: #101607; }
  :global(:root[data-theme='dark']) header { background: rgb(18 22 16 / 72%); }
  :global(:root[data-theme='dark']) .intro p { color: #101607; }

  .intro {
    position: relative;
    margin: 3rem 0 1.4rem;
    padding: 1.25rem;
    border-radius: 1.4rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }

  .intro-status {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    display: inline-flex;
    align-items: center;
  }

  .intro p {
    width: fit-content;
    margin: 0 0 1rem;
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    color: white;
    background: var(--accent);
    font-size: 0.8rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  h1 {
    max-width: 12ch;
    margin: 0;
    font-size: clamp(3rem, 9vw, 7rem);
    line-height: 0.84;
    letter-spacing: 0;
  }

  .intro span {
    display: block;
    max-width: 56rem;
    margin-top: 1.2rem;
    color: var(--ink-soft);
    font-size: 1.05rem;
    line-height: 1.5;
  }

  @media (max-width: 720px) {
    header {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
    }
    .brand { justify-self: start; }
    .nav-toggle {
      display: inline-block;
      justify-self: end;
    }
    .theme-toggle { justify-self: end; }
    nav {
      margin-left: 0;
      display: none;
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.45rem;
      padding-top: 0.4rem;
    }
    nav.open { display: grid; }
    nav a {
      width: auto;
      justify-content: flex-start;
      gap: 0.45rem;
      padding: 0 0.65rem;
    }
    nav .nav-label {
      position: static;
      width: auto;
      height: auto;
      margin: 0;
      overflow: visible;
      clip: auto;
      white-space: normal;
    }
  }
</style>
