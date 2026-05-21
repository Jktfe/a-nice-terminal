<!--
  BreakConfirmModal — confirm that the user wants to post a context break.
  Phase-1 thin wrapper around ModalShell. Preserves exact exports.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';

  type Props = {
    isOpen: boolean;
    reasonTyped: string;
    onConfirm: () => void;
    onCancel: () => void;
    onReasonInput: (newReason: string) => void;
  };

  let { isOpen, reasonTyped, onConfirm, onCancel, onReasonInput }: Props = $props();

  function handleKeyDown(keyboardEvent: KeyboardEvent) {
    if (!isOpen) return;
    if (keyboardEvent.key === 'Escape') {
      keyboardEvent.preventDefault();
      onCancel();
      return;
    }
    if (keyboardEvent.key === 'Enter' && (keyboardEvent.metaKey || keyboardEvent.ctrlKey)) {
      keyboardEvent.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<ModalShell open={isOpen} onCancel={onCancel} size="default">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <!-- title slot -->
  {#snippet title()}Post a context break?{/snippet}

  <!-- body slot -->
  <p>
    Agents will only see messages posted after this break. Older context
    stays visible to humans.
  </p>

  <label for="breakReasonField">Reason (optional)</label>
  <input
    id="breakReasonField"
    type="text"
    autocomplete="off"
    placeholder="e.g. starting the next sprint"
    value={reasonTyped}
    oninput={(event) => onReasonInput(event.currentTarget.value)}
  />

  <p class="hint">Cmd-Enter to post · Esc to cancel</p>

  <!-- actions slot -->
  {#snippet actions()}
    <button type="button" class="cancel" onclick={onCancel}>Cancel</button>
    <button type="button" class="primary" onclick={onConfirm}>Post break</button>
  {/snippet}
</ModalShell>

<style>
  p {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.4;
  }

  label {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
  }

  input {
    padding: 0.6rem 0.8rem;
    font-size: 0.95rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    background: var(--bg);
    color: var(--ink-strong);
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hint {
    margin: 0.3rem 0 0;
    font-size: 0.72rem;
    color: var(--ink-soft);
  }

  button.cancel {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-weight: 700;
    cursor: pointer;
  }

  button.primary {
    padding: 0.5rem 1.1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }
</style>
