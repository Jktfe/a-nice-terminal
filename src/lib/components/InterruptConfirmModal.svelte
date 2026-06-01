<!-- Confirm one-shot terminal/session interrupt. This sends ESC only; it does not kill the terminal or post a context break. -->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';

  type Props = {
    open: boolean;
    targetLabel: string;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
  };

  let { open, targetLabel, onCancel, onConfirm }: Props = $props();
  let confirming = $state(false);

  async function handleConfirm(): Promise<void> {
    if (confirming) return;
    confirming = true;
    try {
      await onConfirm();
    } finally {
      confirming = false;
    }
  }
</script>

<ModalShell {open} {onCancel} size="default">
  {#snippet title()}Interrupt terminal?{/snippet}

  <form onsubmit={(event) => { event.preventDefault(); void handleConfirm(); }}>
    <p>
      Send <code>Esc</code> to <code>{targetLabel}</code> so the running agent or terminal app stops its current action.
      This does not kill the terminal or create a context break.
    </p>
  </form>

  {#snippet actions()}
    <button type="button" class="secondary" onclick={onCancel} disabled={confirming}>Cancel</button>
    <button type="submit" class="interrupt" disabled={confirming} onclick={() => void handleConfirm()}>
      {confirming ? 'Sending…' : 'Send Esc'}
    </button>
  {/snippet}
</ModalShell>

<style>
  p {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.9rem;
    line-height: 1.4;
  }
  code {
    padding: 0.1rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--bg);
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  button {
    padding: 0.5rem 1.1rem;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-strong);
  }
  .interrupt {
    border: 1px solid var(--accent, #c63b3b);
    background: var(--accent, #c63b3b);
    color: white;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
