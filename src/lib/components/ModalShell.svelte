<!--
  ModalShell — generic modal container using native <dialog>.

  Handles: open/close via showModal()/close(), Escape dismissal,
  backdrop click dismissal, focus trap, aria attributes.

  Snippet props:
    - title     → h2 content
    - children  → body content (default slot)
    - actions   → button row

  Props:
    - open      → boolean, controls visibility
    - onCancel  → called on Escape, backdrop click, or explicit cancel
    - size?     → 'narrow' | 'default' | 'wide' (default: 'default')
    - data-testid → optional
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    open: boolean;
    onCancel: () => void;
    size?: 'narrow' | 'default' | 'wide';
    'data-testid'?: string;
    title?: Snippet;
    actions?: Snippet;
    children?: Snippet;
  };

  let { open, onCancel, size = 'default', 'data-testid': testId, title, actions, children }: Props = $props();

  let dialogElement = $state<HTMLDialogElement | null>(null);
  let headingId = $state(`modal-heading-${Math.random().toString(36).slice(2, 8)}`);

  $effect(() => {
    if (!dialogElement) return;
    if (open && !dialogElement.open) {
      dialogElement.showModal();
    } else if (!open && dialogElement.open) {
      dialogElement.close();
    }
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogElement) {
      onCancel();
    }
  }

  function handleCancelEvent(event: Event) {
    event.preventDefault();
    onCancel();
  }

  const sizeClass = $derived.by(() => {
    switch (size) {
      case 'narrow': return 'modal-shell--narrow';
      case 'wide': return 'modal-shell--wide';
      default: return 'modal-shell--default';
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogElement}
  class="modal-shell {sizeClass}"
  aria-labelledby={headingId}
  data-testid={testId}
  onclick={handleBackdropClick}
  oncancel={handleCancelEvent}
>
  <h2 id={headingId}>{@render title?.()}</h2>
  <div class="modal-shell__body">{@render children?.()}</div>
  <div class="modal-shell__actions">{@render actions?.()}</div>
</dialog>

<style>
  .modal-shell {
    padding: 1.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    box-shadow: var(--shadow-card, 0 12px 32px rgba(20, 18, 14, 0.22));
  }

  .modal-shell::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  .modal-shell--narrow {
    width: min(360px, calc(100vw - 2rem));
  }

  .modal-shell--default {
    width: min(420px, calc(100vw - 2rem));
  }

  .modal-shell--wide {
    width: min(560px, calc(100vw - 2rem));
  }

  .modal-shell h2 {
    margin: 0 0 0.9rem;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }

  .modal-shell__body {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .modal-shell__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
    margin-top: 1.2rem;
  }
</style>
