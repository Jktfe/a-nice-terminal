<!--
  CollapsibleSection — native <details>/<summary> wrapper used by the
  reshaped room view (room-view-layout-reshape design 2026-05-14). One
  styled section header with optional count + body slot. Open state
  controlled by the `open` prop OR by the URL hash (id=section).

  Pin-to-side-panel affordance (msg_woy8tl2km1 + msg_r2qkxstx6k): when
  onTogglePin is provided, an inline pin/unpin button is added to the
  header so the user can move this section between the More dropdown
  and the right side panel. isPinned drives the button label/state.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { roomSidePanelPins } from '$lib/stores/roomSidePanelPins.svelte';

  type Props = {
    id: string;
    title: string;
    open?: boolean;
    count?: number | string;
    children?: Snippet;
    /** Explicit pinned-state override. Prefer pinRoomId for room-scoped
     *  sections — passing pinRoomId auto-derives isPinned + onTogglePin
     *  from the roomSidePanelPins store with zero per-callsite plumbing. */
    isPinned?: boolean;
    onTogglePin?: () => void;
    /** When set, the section auto-shows a pin button bound to the
     *  roomSidePanelPins store for (pinRoomId, id). Explicit isPinned
     *  + onTogglePin props win if both are passed. */
    pinRoomId?: string;
  };

  let {
    id, title, open = false, count, children,
    isPinned, onTogglePin, pinRoomId
  }: Props = $props();

  // Auto-bind to the per-room pin store when pinRoomId is set + no
  // explicit override is provided. Keeps callsites tiny (one prop) while
  // still allowing manual control in other contexts (e.g. dashboard).
  const resolvedIsPinned = $derived(
    isPinned !== undefined
      ? isPinned
      : pinRoomId
        ? roomSidePanelPins.isPinned(pinRoomId, id)
        : false
  );
  function handleToggleClick() {
    if (onTogglePin) {
      onTogglePin();
      return;
    }
    if (pinRoomId) {
      roomSidePanelPins.togglePin(pinRoomId, id);
    }
  }
  const showPinButton = $derived(onTogglePin !== undefined || pinRoomId !== undefined);

  let detailsRef = $state<HTMLDetailsElement | null>(null);
  let hasBeenOpened = $state(false);
  // Track open reactively so parents passing open={true} (or flipping it later)
  // also trip the lazy-mount gate. Plain `$state(open)` only captured the
  // initial snapshot and svelte-check warned about it.
  $effect(() => {
    if (open) hasBeenOpened = true;
  });

  // JWPK msg_yymzxywxwy: open/closed state must persist per (pinRoomId, id).
  // The native <details> element tracks open state in the DOM but doesn't
  // remember it across navigation/refresh — without this each visit
  // returned the section to its `open` prop default. Key scope: when
  // pinRoomId is set the persistence is room-scoped; otherwise it falls
  // back to a global section-id key (still useful for non-room sections).
  function persistKey(): string {
    return pinRoomId
      ? `ant.section.open.${pinRoomId}.${id}`
      : `ant.section.open.global.${id}`;
  }
  function readPersistedOpen(): boolean | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(persistKey());
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null;
    } catch {
      return null;
    }
  }
  function writePersistedOpen(next: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(persistKey(), next ? 'true' : 'false');
    } catch {
      /* private-mode safe */
    }
  }

  onMount(() => {
    // Hash-based deep link wins over persisted state: if the URL points
    // at this section, force-open regardless of what the user last did.
    if (location.hash.replace('#', '') === id && detailsRef) {
      detailsRef.open = true;
      hasBeenOpened = true;
      return;
    }
    // Otherwise replay the operator's last open/close choice for this
    // (pinRoomId, id) pair so it persists across navigation + refresh.
    const persisted = readPersistedOpen();
    if (persisted !== null && detailsRef) {
      detailsRef.open = persisted;
      if (persisted) hasBeenOpened = true;
    }
  });

  // Lazy-mount children only after the section is opened at least once.
  // Previously every CollapsibleSection mounted children eagerly inside
  // <details> — details only hides them visually, children still ran
  // their $effects + fetches on mount. With ~12 sections per room page
  // this fanned out enough work to crash browsers on active rooms.
  // Once a section has been opened, we keep it mounted so close+reopen
  // is instant.
  function handleToggle(event: Event) {
    const detail = event.currentTarget as HTMLDetailsElement;
    if (detail.open) hasBeenOpened = true;
    // Persist the operator's choice so the next visit restores it.
    writePersistedOpen(detail.open);
  }
</script>

<details bind:this={detailsRef} class="collapsible-section" {id} {open} ontoggle={handleToggle}>
  <summary>
    <span class="title">{title}</span>
    {#if count !== undefined}<span class="count">({count})</span>{/if}
    <span class="chevron" aria-hidden="true">▾</span>
    {#if showPinButton}
      <button
        type="button"
        class="pin-button"
        class:pinned={resolvedIsPinned}
        aria-label={resolvedIsPinned ? `Unpin ${title} from side panel` : `Pin ${title} to side panel`}
        title={resolvedIsPinned ? 'Unpin from side panel' : 'Pin to side panel'}
        onclick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleToggleClick();
        }}
      >
        <!-- JWPK msg_3puk4fttyf "still doesn't look like a pin" — every
             previous SVG attempt (teardrop, angled-head + needle) failed
             the icon-size recognition test. Switching to the native 📌
             emoji which every OS renders as a clearly-readable pushpin.
             Pinned vs unpinned still differentiates via the .pinned
             class background + border tint on the wrapping button. -->
        <span class="pin-emoji" aria-hidden="true">📌</span>
      </button>
    {/if}
  </summary>
  <div class="body">
    {#if hasBeenOpened}
      {@render children?.()}
    {/if}
  </div>
</details>

<style>
  .collapsible-section {
    margin: 0.65rem 0;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    overflow: hidden;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    color: var(--ink-strong);
    font-weight: 800;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  .title { font-size: 1rem; }
  .count { color: var(--ink-soft); font-weight: 700; font-size: 0.9rem; }
  .chevron { margin-left: auto; transition: transform 180ms; }
  details[open] .chevron { transform: rotate(180deg); }
  .body { padding: 0 1rem 1rem; }
  .pin-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    padding: 0;
    margin-left: 0.35rem;
    border: 1px solid transparent;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .pin-button .pin-emoji {
    font-size: 0.95rem;
    line-height: 1;
  }
  .pin-button:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .pin-button.pinned {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .pin-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (max-width: 768px) {
    .collapsible-section {
      margin: 0.4rem 0;
      border-radius: 0.75rem;
    }
    summary {
      min-height: 44px;
      gap: 0.35rem;
      padding: 0.3rem 0.6rem;
    }
    .title {
      font-size: 0.82rem;
    }
    .count {
      font-size: 0.78rem;
    }
    .body {
      padding: 0 0.6rem 0.6rem;
    }
    .pin-button {
      width: 1.8rem;
      height: 1.8rem;
      margin-left: 0.15rem;
    }
  }
</style>
