<!--
  ChatComposerUploadStatus — small status pill above the composer textarea
  showing "Uploading X" / "Uploading N files…" while file uploads are
  in flight (drag/drop, paste, or attach-button).

  PURE RENDER. Parent (ChatComposer) owns the upload pipeline + the
  in-flight list; this component only renders when uploadsInFlight is
  non-empty.

  Extracted from ChatComposer.svelte to keep the parent under the
  600-line cap (scripts/check-component-lines.mjs). Markup + CSS lifted
  verbatim to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  type Props = {
    uploadsInFlight: string[];
  };

  let { uploadsInFlight }: Props = $props();
</script>

{#if uploadsInFlight.length > 0}
  <p class="upload-status" role="status">
    Uploading {uploadsInFlight.length === 1 ? uploadsInFlight[0] : `${uploadsInFlight.length} files…`}
  </p>
{/if}

<style>
  .upload-status {
    margin: 0;
    padding: 0.35rem 0.6rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    font-size: 0.82rem;
    font-weight: 700;
  }
</style>
