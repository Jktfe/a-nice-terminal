<!--
  ChatComposerEditingPill — visible "Editing your message — cancel (Esc)"
  pill that appears above the composer textarea when the composer is in
  edit mode (issue #76 in-place edit flow).

  PURE RENDER + ONE CALLBACK. Parent (ChatComposer) decides whether to
  mount it (editingMessageId !== null) and owns the cancel-edit state
  machine; this component only renders + raises onCancel().

  Extracted from ChatComposer.svelte to keep the parent under the
  600-line cap (scripts/check-component-lines.mjs). Markup + CSS lifted
  verbatim to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  type Props = {
    onCancel: () => void;
  };

  let { onCancel }: Props = $props();
</script>

<p class="editing-pill" role="status">
  Editing your message —
  <button type="button" class="cancel-edit" onclick={onCancel}>cancel (Esc)</button>
</p>

<style>
  /* #76 — editing-mode indicator pill. Sits above the textarea so the
     user sees "I'm editing, not posting new" + can hit Esc / click to
     cancel without losing the text. */
  .editing-pill {
    margin: 0;
    padding: 0.35rem 0.75rem;
    border: 1px dashed var(--accent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    font-size: 0.82rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .cancel-edit {
    margin-left: auto;
    padding: 0.18rem 0.6rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .cancel-edit:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
</style>
