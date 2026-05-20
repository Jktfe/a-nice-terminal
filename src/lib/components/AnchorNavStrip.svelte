<!--
  AnchorNavStrip — sticky in-page anchor nav with IntersectionObserver-driven
  active tab + smooth-scroll on click.

  Generalised from SettingsTabs.svelte (which is hardcoded to ~5 settings
  tabs and wraps onto a second row). This component:
   - accepts an arbitrary number of tabs
   - horizontally scrolls on narrow viewports instead of wrapping
   - shows an optional per-tab count badge
   - respects prefers-reduced-motion for the smooth-scroll
   - uses location.hash for deep-linkable section nav

  IntersectionObserver tracks which `<section id={tab.id}>` is in view and
  highlights the matching tab. The rootMargin keeps the highlight from
  flicker-thrashing between adjacent tabs on slow scroll.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type Tab = { id: string; label: string; count?: number };
  type Props = { tabs: Tab[]; ariaLabel?: string };

  let { tabs, ariaLabel = 'Sections' }: Props = $props();

  let activeTabId = $state<string>('');
  let stripElement = $state<HTMLElement | null>(null);

  // Breathing gap between the sticky strip's bottom edge and the target
  // heading. Small enough not to leave a noticeable dead band, large
  // enough that the heading isn't kissing the strip.
  const SCROLL_GAP_PX = 12;

  onMount(() => {
    const fromHash = location.hash.replace('#', '');
    activeTabId = fromHash && tabs.some((t) => t.id === fromHash)
      ? fromHash
      : tabs[0]?.id ?? '';

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeTabId = entry.target.id;
            break;
          }
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
    );
    for (const tab of tabs) {
      const el = document.getElementById(tab.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  });

  function jumpTo(id: string) {
    activeTabId = id;
    const el = document.getElementById(id);
    if (!el) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Compute the scroll target: where the target heading would land
    // absent the sticky strip, minus the strip's own height + a gap.
    // Done at click-time so the offset tracks the strip's actual size
    // (wraps differently at different viewport widths, can grow as
    // groups are added).
    const stripHeight = stripElement?.getBoundingClientRect().height ?? 0;
    const targetY =
      window.scrollY + el.getBoundingClientRect().top - stripHeight - SCROLL_GAP_PX;

    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
    history.replaceState(null, '', `#${id}`);
  }
</script>

<nav class="anchor-nav-strip" aria-label={ariaLabel} bind:this={stripElement}>
  <div class="anchor-nav-scroller">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="anchor-nav-tab"
        class:active={activeTabId === tab.id}
        onclick={() => jumpTo(tab.id)}
      >
        {tab.label}
        {#if typeof tab.count === 'number'}
          <span class="anchor-nav-count">{tab.count}</span>
        {/if}
      </button>
    {/each}
  </div>
</nav>

<style>
  .anchor-nav-strip {
    position: sticky;
    top: 0.5rem;
    z-index: 5;
    margin-bottom: 1rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--surface-card) 88%, transparent);
    backdrop-filter: blur(12px);
  }

  .anchor-nav-scroller {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .anchor-nav-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
    padding: 0.35rem 0.8rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font-weight: 750;
    font-size: 0.88rem;
    white-space: nowrap;
    cursor: pointer;
  }

  .anchor-nav-tab:hover { background: var(--bg); }

  .anchor-nav-tab.active {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }

  .anchor-nav-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-strong) 12%, transparent);
    color: inherit;
    font-size: 0.75rem;
    font-weight: 800;
  }

  .anchor-nav-tab.active .anchor-nav-count {
    background: rgb(255 255 255 / 22%);
  }

  :global(:root[data-theme='dark']) .anchor-nav-tab.active { color: #101607; }
</style>
