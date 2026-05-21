<!--
  RemoveMemberConfirmModal — destructive confirm before removing a member.
  Refactored to ModalShell; native <dialog> handles focus trap + Escape.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';

  type Props = {
    memberHandle: string;
    onConfirm: () => void;
    onCancel: () => void;
  };

  let { memberHandle, onConfirm, onCancel }: Props = $props();
</script>

<ModalShell open={true} {onCancel} size="default">
  {#snippet title()}Remove {memberHandle}?{/snippet}

  <p>
    Remove <strong>{memberHandle}</strong> from this room? They will need a new invite to rejoin.
  </p>

  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="safe" onclick={onCancel} autofocus>Cancel</button>
    <button type="button" class="destructive" onclick={onConfirm}>Remove</button>
  {/snippet}
</ModalShell>

<style>
  p {
    margin: 0;
    color: var(--ink);
    line-height: 1.45;
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
