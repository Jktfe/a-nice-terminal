<!--
  ChatComposerAttachButton — paperclip button + hidden file input pair
  for the composer footer. Clicking the visible button triggers the
  hidden <input type="file" multiple>; selected files are raised via
  onFilesSelected so the parent can run them through the same upload
  pipeline as drag/drop and paste.

  PURE RENDER + ONE CALLBACK. Parent (ChatComposer) owns the upload
  flow + disabled state machine; this component only owns the local
  input ref so it can click() and clear the value after each pick.

  Extracted from ChatComposer.svelte to keep the parent under the
  600-line cap (scripts/check-component-lines.mjs). Markup + CSS lifted
  verbatim to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  type Props = {
    disabled?: boolean;
    onFilesSelected: (files: File[]) => void;
  };

  let { disabled = false, onFilesSelected }: Props = $props();

  let attachInputRef = $state<HTMLInputElement | null>(null);
</script>

<input
  type="file"
  bind:this={attachInputRef}
  class="attach-input"
  multiple
  aria-hidden="true"
  tabindex="-1"
  onchange={(event) => {
    const fileList = event.currentTarget.files;
    if (fileList && fileList.length > 0) {
      onFilesSelected(Array.from(fileList));
    }
    event.currentTarget.value = '';
  }}
/>
<button
  type="button"
  class="attach-action"
  aria-label="Attach a file"
  title="Attach a file"
  onclick={() => attachInputRef?.click()}
  {disabled}
>📎</button>

<style>
  .attach-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .attach-action {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font-size: 1rem;
    cursor: pointer;
  }
  .attach-action:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .attach-action:disabled { opacity: 0.55; cursor: not-allowed; }

  @media (max-width: 768px) {
    .attach-action {
      width: 44px;
      height: 44px;
      font-size: 0.92rem;
    }
  }
</style>
