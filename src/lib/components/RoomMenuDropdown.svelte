<!--
  RoomMenuDropdown — single outer <details> that holds the room's
  context sections (Participants/Asks/Memory/Attachments). Defaults
  closed so chat gets full vertical real-estate per JWPK D2.7. Inner
  sections are passed via the children slot (CollapsibleSection
  instances). URL hash deep-link forces open if any inner section's
  id matches.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  type Props = {
    summary?: string;
    children?: Snippet;
    /** Section ids inside the menu — opens the outer if hash matches any. */
    innerIds?: string[];
  };

  let { summary = 'More', children, innerIds = [] }: Props = $props();
  let detailsRef = $state<HTMLDetailsElement | null>(null);

  onMount(() => {
    const fromHash = location.hash.replace('#', '');
    if (fromHash && innerIds.includes(fromHash) && detailsRef) detailsRef.open = true;
  });
</script>

<details bind:this={detailsRef} class="room-menu-dropdown" id="room-menu">
  <summary>
    <span class="label">{summary}</span>
    <span class="chevron" aria-hidden="true">▾</span>
  </summary>
  <div class="menu-body">
    {@render children?.()}
  </div>
</details>

<style>
  .room-menu-dropdown {
    position: relative;
    flex: 0 0 auto;
    margin: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    overflow: visible;
  }
  summary {
    width: fit-content;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: 800;
    font-size: 0.86rem;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .label { font-size: 0.86rem; }
  .chevron { transition: transform 180ms; }
  details[open] .chevron { transform: rotate(180deg); }
  .menu-body {
    position: absolute;
    top: calc(100% + 0.45rem);
    right: 0;
    z-index: 60;
    width: min(640px, calc(100vw - 2rem));
    max-height: min(72vh, 620px);
    overflow-y: auto;
    margin-top: 0;
    padding: 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }

  @media (max-width: 768px) {
    summary {
      min-height: 44px;
      padding: 0.35rem 0.62rem;
      font-size: 0.78rem;
    }
    .label { font-size: 0.78rem; }
    .menu-body {
      position: absolute;
      top: calc(100% + 0.4rem);
      right: 0;
      bottom: auto;
      left: auto;
      width: min(calc(100vw - 1rem), 28rem);
      max-height: min(68svh, 560px);
      margin: 0;
      padding: 0.45rem;
      border-radius: 0.85rem;
      box-shadow: 0 14px 34px rgb(27 20 12 / 18%);
    }
  }
</style>
