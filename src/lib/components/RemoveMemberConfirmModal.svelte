<!--
  RemoveMemberConfirmModal — destructive confirm before removing a member.
  Wireframe board WTHef edge fe33 (Claude lane, x=-6200 y=1800).

  Cancel is the safe default (autofocus). Esc + backdrop click both cancel.
  Tab keys trap inside the dialog. Focus restores to the invoking
  participant row on close.

  Copied-from: src/lib/components/ParticipantDetailSheet.svelte:42-86
    (M03 slices 2-3)
  Verdict: KEEP
  Simplification: same focus-management trick (capture activeElement on
    mount, restore on cleanup; Tab-trap via focusable enumeration),
    scoped down to a 2-button confirm modal.
-->
<script lang="ts">
  type Props = {
    memberHandle: string;
    onConfirm: () => void;
    onCancel: () => void;
  };

  let { memberHandle, onConfirm, onCancel }: Props = $props();

  let dialogElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    // Explicitly move focus into the dialog on mount — autofocus is
    // unreliable for components added dynamically, and the Tab trap below
    // only kicks in once focus is already inside the dialog.
    //
    // Focus restoration on close lives in the parent flow (RemoveMemberFlow)
    // because document.activeElement is already document.body by the time
    // this $effect runs: the detail sheet has just unmounted. The flow
    // restores focus to the originating member row using its data-member-handle
    // attribute, which is more reliable than activeElement capture here.
    setTimeout(() => {
      const focusablesNow = focusableElementsInDialog();
      focusablesNow[0]?.focus();
    }, 0);
  });

  function focusableElementsInDialog(): HTMLElement[] {
    if (!dialogElement) return [];
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(dialogElement.querySelectorAll<HTMLElement>(selector));
  }

  function trapTabKey(event: KeyboardEvent) {
    const focusables = focusableElementsInDialog();
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
      onCancel();
      return;
    }
    if (event.key === 'Tab') trapTabKey(event);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  type="button"
  class="modal-backdrop"
  aria-label="Cancel removing member"
  onclick={onCancel}
></button>

<div
  bind:this={dialogElement}
  class="remove-confirm-dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="removeConfirmHeading"
  aria-describedby="removeConfirmBody"
>
  <h2 id="removeConfirmHeading">Remove {memberHandle}?</h2>
  <p id="removeConfirmBody">
    Remove <strong>{memberHandle}</strong> from this room? They will need a new invite to rejoin.
  </p>
  <div class="dialog-actions">
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="safe" onclick={onCancel} autofocus>Cancel</button>
    <button type="button" class="destructive" onclick={onConfirm}>Remove</button>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    border: none;
    cursor: pointer;
    padding: 0;
    z-index: 1000;
  }
  .remove-confirm-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 2rem));
    padding: 1.5rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
    box-shadow: var(--shadow-card);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  p {
    margin: 0;
    color: var(--ink);
    line-height: 1.45;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
  }
  button {
    padding: 0.55rem 1.1rem;
    font-weight: 800;
    font-size: 0.95rem;
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
  }
  button.safe {
    background: transparent;
    border: 1px solid var(--surface-edge);
    color: var(--ink);
  }
  button.destructive {
    background: #c92020;
    border: none;
    color: white;
  }
  button.destructive:hover { filter: brightness(1.05); }
</style>
