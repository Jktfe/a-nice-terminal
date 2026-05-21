<!--
  ChatComposerAttachmentChips — preview row of attached files above the
  composer textarea. One chip per attached file with image thumbnail (for
  image mimes) or paperclip icon for others, plus an × to drop the chip.

  PURE RENDER + ONE CALLBACK. Parent (ChatComposer) owns the chips array +
  the side-effecting remove logic (URL.revokeObjectURL + body strip);
  this component only renders + raises onRemove(attachmentId).

  Extracted from ChatComposer.svelte to keep the parent under the 600-line
  cap (scripts/check-component-lines.mjs). Markup + CSS lifted verbatim
  to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  export type AttachedChip = {
    attachmentId: string;
    filename: string;
    mimeType: string;
    markdownLink: string;
    previewObjectUrl: string | null;
  };

  type Props = {
    chips: AttachedChip[];
    onRemove: (attachmentId: string) => void;
  };

  let { chips, onRemove }: Props = $props();
</script>

{#if chips.length > 0}
  <!-- Composer attachment thumbnails. One chip per attached file
       with a small image preview (for image mimes) or paperclip icon
       for others, plus an × to drop the chip and strip its markdown
       link from the body before sending. -->
  <ul class="attached-chips" aria-label="Attached files">
    {#each chips as chip (chip.attachmentId)}
      <li class="attached-chip">
        {#if chip.previewObjectUrl}
          <img class="chip-thumb" src={chip.previewObjectUrl} alt={chip.filename} />
        {:else}
          <span class="chip-icon" aria-hidden="true">📎</span>
        {/if}
        <span class="chip-name" title={chip.filename}>{chip.filename}</span>
        <button
          type="button"
          class="chip-remove"
          aria-label={`Remove ${chip.filename}`}
          title="Remove attachment"
          onclick={() => onRemove(chip.attachmentId)}
        >×</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  /* Composer attachment chips — preview row above the textarea. */
  .attached-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .attached-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.45rem 0.25rem 0.3rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.82rem;
    max-width: 14rem;
  }
  .chip-thumb {
    width: 1.8rem;
    height: 1.8rem;
    object-fit: cover;
    border-radius: 0.35rem;
    flex-shrink: 0;
    background: var(--bg);
  }
  .chip-icon {
    width: 1.8rem;
    height: 1.8rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .chip-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .chip-remove {
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.95rem;
    font-weight: 800;
    cursor: pointer;
    border-radius: 999px;
    line-height: 1;
    flex-shrink: 0;
  }
  .chip-remove:hover { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
  @media (pointer: coarse) {
    .chip-remove { width: 1.75rem; height: 1.75rem; font-size: 1.05rem; }
  }
</style>
