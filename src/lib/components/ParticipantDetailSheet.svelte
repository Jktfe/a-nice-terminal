<!--
  ParticipantDetailSheet — overlay sheet showing one member's actions.
  Wireframe board WTHef state h02 (Claude lane, x=-6200 y=1800).
  Right-side on >=768px, full-screen on <768px. Esc + backdrop close.
  Tab keys trap inside the dialog. Focus restores to the invoking row
  on close. Body defaults to the 4-action list; alternateBody snippet
  swaps in ChangeHandleForm without duplicating sheet chrome.
  Per fe32 Remove hides when canManageMembers is false. Per fe33 the
  destructive confirm modal lands in M03 slice 5.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import MemberIcon from './MemberIcon.svelte';

  type SheetAction = 'change-handle' | 'edit-presentation' | 'view-activity' | 'set-focus' | 'remove' | 'close';

  type Props = {
    member: RoomMember;
    aliasInRoom?: string;
    canManageMembers?: boolean;
    onAction: (action: SheetAction) => void;
    onClose: () => void;
    alternateBody?: Snippet;
  };

  let {
    member,
    aliasInRoom,
    canManageMembers = true,
    onAction,
    onClose,
    alternateBody
  }: Props = $props();

  let sheetElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const focusBeforeMount =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Restore focus on next tick so the trigger row is mounted and focusable.
    return () => setTimeout(() => focusBeforeMount?.focus(), 0);
  });

  function focusableElementsInSheet(): HTMLElement[] {
    if (!sheetElement) return [];
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(sheetElement.querySelectorAll<HTMLElement>(focusableSelector));
  }

  function trapTabKey(event: KeyboardEvent) {
    const focusables = focusableElementsInSheet();
    if (focusables.length === 0) return;
    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus();
    } else if (!event.shiftKey && activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      trapTabKey(event);
    }
  }

  function firstLetterOf(displayName: string): string {
    const startIndex = displayName.startsWith('@') ? 1 : 0;
    const letter = displayName.charAt(startIndex);
    return letter.toUpperCase() || '?';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  type="button"
  class="sheet-backdrop"
  aria-label="Close participant detail"
  onclick={onClose}
></button>

<div
  bind:this={sheetElement}
  class="participant-sheet"
  role="dialog"
  aria-modal="true"
  aria-labelledby="participantSheetHeading"
>
  <header class="sheet-top">
    <div class="avatar" style:--member-color={member.displayColor} aria-hidden="true">
      <MemberIcon icon={member.displayIcon} fallbackText={member.displayName} size="lg" />
    </div>
    <div class="identity">
      <p id="participantSheetHeading" class="display-name">
        {aliasInRoom ?? member.displayName}
      </p>
      <p class="global-handle">
        {member.handle}{aliasInRoom ? ' · shown as ' + aliasInRoom : ''}
      </p>
    </div>
  </header>

  {#if alternateBody}
    {@render alternateBody()}
  {:else}
    <ul class="action-rows">
      <li>
        <!-- svelte-ignore a11y_autofocus -->
        <button
          type="button"
          class="action-row"
          onclick={() => onAction('edit-presentation')}
          autofocus
        >Edit room identity</button>
      </li>
      <li>
        <button
          type="button"
          class="action-row"
          onclick={() => onAction('change-handle')}
        >Set @mention alias</button>
      </li>
      <li>
        <button
          type="button"
          class="action-row"
          onclick={() => onAction('set-focus')}
        >Set focus</button>
      </li>
      <li>
        <button type="button" class="action-row" disabled>
          View activity <span class="placeholder-note">(soon)</span>
        </button>
      </li>
      {#if canManageMembers}
        <li>
          <button
            type="button"
            class="action-row destructive"
            onclick={() => onAction('remove')}
          >Remove from this room</button>
        </li>
      {/if}
      <li>
        <button type="button" class="action-row" onclick={() => onAction('close')}>
          Close
        </button>
      </li>
    </ul>
  {/if}
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    cursor: pointer;
    padding: 0;
    z-index: 80;
  }
  .participant-sheet {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100vw);
    padding: 1.5rem;
    background: var(--surface-card);
    border-left: 1px solid var(--line-soft);
    box-shadow: -24px 0 60px rgb(0 0 0 / 24%);
    color: var(--ink-strong);
    z-index: 81;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    overflow-y: auto;
  }
  :global(:root[data-theme='dark']) .participant-sheet {
    background: #151a12;
    border-left-color: #465437;
    box-shadow: -24px 0 70px rgb(0 0 0 / 58%);
  }
  @media (max-width: 767px) {
    .participant-sheet {
      width: 100vw;
      border-left: none;
    }
  }
  .sheet-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .avatar {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 999px;
    background: var(--member-color, var(--accent));
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 1rem;
  }
  .identity {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .display-name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .global-handle {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
  }
  .action-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .action-row {
    width: 100%;
    padding: 0.7rem 0.85rem;
    text-align: left;
    background: var(--surface-raised);
    border: 1px solid var(--line-soft);
    border-radius: 0.6rem;
    cursor: pointer;
    font: inherit;
    color: var(--ink-strong);
    font-weight: 700;
  }
  :global(:root[data-theme='dark']) .action-row {
    background: #222b1c;
    border-color: #465437;
  }
  .action-row:hover:not(:disabled),
  .action-row:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .action-row:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .action-row.destructive {
    color: #c92020;
    border-color: rgba(201, 32, 32, 0.4);
  }
  .action-row.destructive:hover:not(:disabled) {
    background: rgba(201, 32, 32, 0.08);
    border-color: #c92020;
  }
  .placeholder-note {
    font-size: 0.75rem;
    color: var(--ink-soft);
    font-weight: 600;
  }
</style>
