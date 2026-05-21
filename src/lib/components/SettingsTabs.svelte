<!--
  SettingsTabs — anchored nav strip for the Settings home page (Q1
  per Settings Home design contract 2026-05-14). Smooth-scrolls to
  the matching <section id="..."> on the Settings page. Highlights
  the section currently in view via IntersectionObserver.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type Props = { tabs: { id: string; label: string }[] };
  let { tabs }: Props = $props();

  let activeTabId = $state<string>('');

  onMount(() => {
    const fromHash = location.hash.replace('#', '');
    activeTabId = fromHash && tabs.some((t) => t.id === fromHash) ? fromHash : tabs[0]?.id ?? '';

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
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  }
</script>

<nav class="settings-tabs" aria-label="Settings sections">
  {#each tabs as tab}
    <button
      type="button"
      class="settings-tab"
      class:active={activeTabId === tab.id}
      onclick={() => jumpTo(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .settings-tabs {
    position: sticky;
    top: 0.5rem;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.6rem;
    margin-bottom: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    backdrop-filter: blur(12px);
  }
  .settings-tab {
    padding: 0.45rem 0.85rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font-weight: 750;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .settings-tab:hover { background: var(--bg); }
  .settings-tab.active {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  :global(:root[data-theme='dark']) .settings-tab.active { color: #101607; }
</style>
